// studio-emu: a headless mGBA (libmgba 0.10) the studio drives over stdin/stdout.
//
// One command per line; every command answers exactly one line, "ok ..." or "err ...".
//   frames N            run N frames                          -> ok <frame counter>
//   keys MASK           hold GBA keys (A=1 B=2 SELECT=4 START=8 RIGHT=16 LEFT=32 UP=64 DOWN=128 R=256 L=512)
//   shot PATH           write the current frame as raw RGBA (240x160x4) -> ok 240 160
//   read ADDR LEN       bus read, ADDR hex                    -> ok <hex bytes>
//   write ADDR HEX      bus write of the given bytes          -> ok
//   save PATH           save state (with save data) to PATH   -> ok
//   load PATH           load state from PATH                  -> ok
//   reset               power cycle                           -> ok
//   video PATH|off      every frame run from now goes to ffmpeg as PATH (.mp4, 240x160, the console's frame rate)
//                       -> ok 240 160; `video off` finishes the file -> ok <frames>
//   frame               current frame counter                 -> ok <n>
//   layer ID 0|1        hide/show a video layer (0-3 BG0-3, 4 OBJ); drawing only
//   rtc host|fixed MS|epoch MS   cartridge clock: the host clock (default), frozen at MS (Unix
//                       ms), or starting at MS and advancing with emulated frames (deterministic)
//   audio PATH|off      record what the game plays to PATH as a 16-bit stereo .wav at the console's own
//                       output rate (read from SOUNDBIAS; 65536 Hz under the game's driver) -> ok <rate>; `audio off` stops and
//                       finishes the file -> ok <sample frames>. Off unless asked: without it the sound
//                       stays muted exactly as before, and recording never changes what the game does.
//   quit
// The game never waits on us: nothing runs between commands, so a script is fully deterministic
// apart from the cartridge clock (RTC), which follows the host clock as on hardware.
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/core/interface.h>
#include <mgba-util/vfs.h>

#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#define WIDTH 240
#define HEIGHT 160
#define STRIDE 256

static color_t video[STRIDE * HEIGHT];
static struct mCore* core;

// ---- sound recording (off unless the `audio` command asks) ----
static FILE* audioFile = NULL;
static unsigned long audioFrames = 0;
static unsigned audioRate = 32768;

static void put32(FILE* f, uint32_t v) { unsigned char b[4] = { v, v >> 8, v >> 16, v >> 24 }; fwrite(b, 1, 4, f); }
static void put16(FILE* f, uint16_t v) { unsigned char b[2] = { v, v >> 8 }; fwrite(b, 1, 2, f); }

static void wavHeader(FILE* f, unsigned rate, unsigned long frames) {
	fseek(f, 0, SEEK_SET);
	fwrite("RIFF", 1, 4, f); put32(f, 36 + frames * 4); fwrite("WAVEfmt ", 1, 8, f);
	put32(f, 16); put16(f, 1); put16(f, 2); put32(f, rate); put32(f, rate * 4); put16(f, 4); put16(f, 16);
	fwrite("data", 1, 4, f); put32(f, frames * 4);
}

static void onAudioFrame(struct mAVStream* stream, int16_t left, int16_t right) {
	(void) stream;
	if (!audioFile) return;
	put16(audioFile, (uint16_t) left); put16(audioFile, (uint16_t) right);
	++audioFrames;
}

static void onAudioRate(struct mAVStream* stream, unsigned rate) {
	(void) stream; (void) rate;
	// The game may change the output rate (SOUNDBIAS) mid-recording; the file keeps the rate it started with.
}

static struct mAVStream audioStream = { .postAudioFrame = onAudioFrame, .audioRateChanged = onAudioRate };

static void setVolume(int volume) {
	core->opts.volume = volume;
	core->reloadConfigOption(core, NULL, NULL);
}

static void cmdAudio(const char* arg) {
	if (!strcmp(arg, "off")) {
		if (!audioFile) { printf("err not recording\n"); return; }
		wavHeader(audioFile, audioRate, audioFrames);
		fclose(audioFile);
		audioFile = NULL;
		core->setAVStream(core, NULL);
		setVolume(0);
		printf("ok %lu\n", audioFrames);
		return;
	}
	if (audioFile) { printf("err already recording\n"); return; }
	audioFile = fopen(arg, "wb");
	if (!audioFile) { printf("err cannot open %s\n", arg); return; }
	audioFrames = 0;
	// The console's own output rate: SOUNDBIAS (0x4000088) bits 14-15 pick 32768 << n Hz (the game's sound
	// driver sets n = 1, 65536 Hz). A recording keeps the rate it started with.
	audioRate = 32768u << ((core->busRead16(core, 0x04000088) >> 14) & 3);
	wavHeader(audioFile, audioRate, 0);
	core->setAVStream(core, &audioStream);
	setVolume(0x100);
	printf("ok %u\n", audioRate);
}

static void quietLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger; (void) category; (void) level; (void) format; (void) args;
}
static struct mLogger logger = { .log = quietLog };

static int hexval(char c) {
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

static void cmdShot(const char* path) {
	FILE* f = fopen(path, "wb");
	if (!f) { printf("err cannot open %s\n", path); return; }
	unsigned char row[WIDTH * 4];
	for (int y = 0; y < HEIGHT; ++y) {
		for (int x = 0; x < WIDTH; ++x) {
			color_t c = video[y * STRIDE + x]; // 0x00BBGGRR (mColorFrom555, 32-bit build)
			row[x * 4 + 0] = c & 0xFF;
			row[x * 4 + 1] = (c >> 8) & 0xFF;
			row[x * 4 + 2] = (c >> 16) & 0xFF;
			row[x * 4 + 3] = 0xFF;
		}
		fwrite(row, 1, sizeof(row), f);
	}
	fclose(f);
	printf("ok %d %d\n", WIDTH, HEIGHT);
}

// ---- moving pictures (off unless the `video` command asks): every frame run goes to ffmpeg as raw RGBA ----
static FILE* videoPipe = NULL;
static pid_t videoPid = 0;
static unsigned long videoFrames = 0;
static void videoEnd(void) {
	fclose(videoPipe); videoPipe = NULL;
	waitpid(videoPid, NULL, 0); // ffmpeg finishes the file once its input ends
}
static void videoFrame(void) {
	if (!videoPipe) return;
	unsigned char row[WIDTH * 4];
	for (int y = 0; y < HEIGHT; ++y) {
		for (int x = 0; x < WIDTH; ++x) {
			color_t c = video[y * STRIDE + x];
			row[x * 4 + 0] = c & 0xFF; row[x * 4 + 1] = (c >> 8) & 0xFF; row[x * 4 + 2] = (c >> 16) & 0xFF; row[x * 4 + 3] = 0xFF;
		}
		fwrite(row, 1, sizeof(row), videoPipe);
	}
	++videoFrames;
}
static void cmdVideo(const char* arg) {
	if (!strcmp(arg, "off")) {
		if (!videoPipe) { printf("err not recording\n"); return; }
		videoEnd();
		printf("ok %lu\n", videoFrames);
		return;
	}
	if (videoPipe) { printf("err already recording\n"); return; }
	if (arg[0] == '-') { printf("err the path may not start with a dash\n"); return; }
	int fd[2];
	char size[32];
	snprintf(size, sizeof(size), "%dx%d", WIDTH, HEIGHT);
	if (pipe(fd)) { printf("err cannot start ffmpeg\n"); return; }
	videoPid = fork();
	if (videoPid < 0) { close(fd[0]); close(fd[1]); printf("err cannot start ffmpeg\n"); return; }
	if (videoPid == 0) { // ffmpeg gets its arguments one by one: no shell ever reads the path
		int quiet = open("/dev/null", O_WRONLY);
		dup2(fd[0], 0); dup2(quiet, 1); dup2(quiet, 2); close(fd[0]); close(fd[1]);
		execlp("ffmpeg", "ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", size, "-r", "16777216/280896", "-i", "-",
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv444p", arg, (char*) NULL);
		_exit(127);
	}
	close(fd[0]);
	videoPipe = fdopen(fd[1], "w");
	if (!videoPipe) { close(fd[1]); printf("err cannot start ffmpeg\n"); return; }
	videoFrames = 0;
	printf("ok %d %d\n", WIDTH, HEIGHT);
}

static void cmdRead(unsigned long addr, unsigned long len) {
	if (len > 0x40000) { printf("err too long\n"); return; }
	char* out = malloc(len * 2 + 1);
	static const char digits[] = "0123456789abcdef";
	for (unsigned long i = 0; i < len; ++i) {
		uint32_t b = core->busRead8(core, (uint32_t) (addr + i));
		out[i * 2] = digits[(b >> 4) & 0xF];
		out[i * 2 + 1] = digits[b & 0xF];
	}
	out[len * 2] = '\0';
	printf("ok %s\n", out);
	free(out);
}

static void cmdWrite(unsigned long addr, const char* hex) {
	size_t n = strlen(hex);
	if (n % 2) { printf("err odd hex\n"); return; }
	for (size_t i = 0; i < n / 2; ++i) {
		int hi = hexval(hex[i * 2]), lo = hexval(hex[i * 2 + 1]);
		if (hi < 0 || lo < 0) { printf("err bad hex\n"); return; }
		core->busWrite8(core, (uint32_t) (addr + i), (uint8_t) (hi << 4 | lo));
	}
	printf("ok\n");
}

static void cmdState(const char* path, bool save) {
	struct VFile* vf = VFileOpen(path, save ? O_CREAT | O_TRUNC | O_RDWR : O_RDONLY);
	if (!vf) { printf("err cannot open %s\n", path); return; }
	bool ok = save ? mCoreSaveStateNamed(core, vf, SAVESTATE_SAVEDATA | SAVESTATE_RTC)
	               : mCoreLoadStateNamed(core, vf, SAVESTATE_SAVEDATA | SAVESTATE_RTC);
	vf->close(vf);
	printf(ok ? "ok\n" : "err state %s failed\n", save ? "save" : "load");
}

// What follows the command's own word, spaces and all: a path may hold spaces.
static const char* rest(const char* line) {
	while (*line && *line != ' ') ++line;
	while (*line == ' ') ++line;
	return line;
}

int main(int argc, char** argv) {
	if (argc < 2) {
		fprintf(stderr, "usage: studio-emu ROM\n");
		return 2;
	}
	signal(SIGPIPE, SIG_IGN); // ffmpeg stopping early must not end the game with it
	mLogSetDefaultLogger(&logger);
	core = mCoreFind(argv[1]);
	if (!core || !core->init(core)) {
		fprintf(stderr, "cannot create a core for %s\n", argv[1]);
		return 1;
	}
	mCoreInitConfig(core, NULL);
	mCoreConfigSetDefaultValue(&core->config, "idleOptimization", "detect");
	struct mCoreOptions opts = { .useBios = false, .skipBios = true, .audioSync = false, .videoSync = false, .volume = 0 };
	mCoreConfigLoadDefaults(&core->config, &opts);
	mCoreLoadConfig(core);
	core->setVideoBuffer(core, video, STRIDE);
	if (!mCoreLoadFile(core, argv[1])) {
		fprintf(stderr, "cannot load %s\n", argv[1]);
		return 1;
	}
	core->reset(core);

	setvbuf(stdout, NULL, _IOLBF, 0);
	printf("ready %s\n", argv[1]);

	char line[1 << 20];
	while (fgets(line, sizeof(line), stdin)) {
		line[strcspn(line, "\r\n")] = '\0';
		char cmd[16] = { 0 };
		const char* arg = rest(line);
		unsigned long a = 0, b = 0;
		if (sscanf(line, "%15s", cmd) != 1) continue;
		if (!strcmp(cmd, "quit")) {
			printf("ok\n");
			break;
		} else if (!strcmp(cmd, "frames") && sscanf(line, "%*s %lu", &a) == 1) {
			for (unsigned long i = 0; i < a; ++i) { core->runFrame(core); videoFrame(); }
			printf("ok %u\n", core->frameCounter(core));
		} else if (!strcmp(cmd, "keys") && sscanf(line, "%*s %lu", &a) == 1) {
			core->setKeys(core, (uint32_t) a);
			printf("ok\n");
		} else if (!strcmp(cmd, "shot") && *arg) {
			cmdShot(arg);
		} else if (!strcmp(cmd, "read") && sscanf(line, "%*s %lx %lu", &a, &b) == 2) {
			cmdRead(a, b);
		} else if (!strcmp(cmd, "write")) {
			char* hex = malloc(strlen(line) + 1);
			if (sscanf(line, "%*s %lx %s", &a, hex) == 2) cmdWrite(a, hex);
			else printf("err usage: write ADDR HEX\n");
			free(hex);
		} else if (!strcmp(cmd, "save") && *arg) {
			cmdState(arg, true);
		} else if (!strcmp(cmd, "load") && *arg) {
			cmdState(arg, false);
		} else if (!strcmp(cmd, "reset")) {
			core->reset(core);
			printf("ok\n");
		} else if (!strcmp(cmd, "layer") && sscanf(line, "%*s %lu %lu", &a, &b) == 2) {
			// GBA: 0-3 = BG0-BG3, 4 = OBJ (sprites). Only changes what is drawn, never game state.
			core->enableVideoLayer(core, a, b != 0);
			// mGBA re-reads sprites only when OAM changes value; flip one OAM bit and put it back so
			// the next frame honours the new OBJ setting even in a static scene. The game never
			// reads OAM, and the final value is unchanged.
			uint32_t oam0 = core->busRead16(core, 0x07000000);
			core->busWrite16(core, 0x07000000, oam0 ^ 1);
			core->busWrite16(core, 0x07000000, oam0);
			printf("ok\n");
		} else if (!strcmp(cmd, "audio") && *arg) {
			cmdAudio(arg);
		} else if (!strcmp(cmd, "video") && *arg) {
			cmdVideo(arg);
		} else if (!strcmp(cmd, "frame")) {
			printf("ok %u\n", core->frameCounter(core));
		} else if (!strcmp(cmd, "rtc")) {
			// Saved in states (SAVESTATE_RTC), so a state made under a fixed clock keeps it.
			char mode[16] = { 0 };
			long long ms = 0;
			int n = sscanf(line, "%*s %15s %lld", mode, &ms);
			if (n >= 1 && !strcmp(mode, "host")) {
				core->rtc.override = RTC_NO_OVERRIDE;
				printf("ok\n");
			} else if (n == 2 && (!strcmp(mode, "fixed") || !strcmp(mode, "epoch"))) {
				core->rtc.override = !strcmp(mode, "fixed") ? RTC_FIXED : RTC_FAKE_EPOCH;
				core->rtc.value = ms;
				printf("ok\n");
			} else {
				printf("err usage: rtc host|fixed MS|epoch MS\n");
			}
		} else {
			printf("err unknown command: %s\n", line);
		}
	}
	if (audioFile) { wavHeader(audioFile, audioRate, audioFrames); fclose(audioFile); audioFile = NULL; }
	if (videoPipe) videoEnd();
	core->unloadROM(core);
	mCoreConfigDeinit(&core->config);
	core->deinit(core);
	return 0;
}
