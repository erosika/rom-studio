#!/usr/bin/env bun
// kit/agent-play/sample-agent.ts: the smallest player there is, to show the shapes and to try the loop without a model.
//   kit agent-play --agent "bun kit/agent-play/sample-agent.ts"
// It reads one step on standard input and writes one answer. It looks at no picture: it presses A through any text,
// walks until something is in the way, turns, and now and then presses A at what is in front of it.
const step = JSON.parse(await new Response(Bun.stdin.stream()).text());
const TURN: Record<string, string> = { UP: "RIGHT", RIGHT: "DOWN", DOWN: "LEFT", LEFT: "UP" };
let mind = { dir: "DOWN", blocked: 0, walked: 0, poked: 0 }; // the way it is going; how often it was stopped; the step of its last walk; the step it last pressed A at something
try { const m = JSON.parse(step.notes); if (TURN[m.dir]) mind = { dir: m.dir, blocked: Number(m.blocked) || 0, walked: Number(m.walked) || 0, poked: Number(m.poked) || 0 }; } catch {} // the notes are all it remembers

const walk = step.last.find((p: { step: number }) => p.step === mind.walked), stopped = !!walk && /BLOCKED/.test(walk.result);
let answer: { do: string; thought: string };
if (!step.where) answer = { do: step.step % 4 === 0 ? "press START" : "press A", thought: "Not on a map yet: pressing on through the opening." };
else if (step.text) answer = { do: "press A,A", thought: `Reading: ${String(step.text).slice(0, 60)}` };
else if (!step.where.control) answer = { do: step.step % 5 === 0 ? "press B" : "press A", thought: "Something has the controls: pressing to move it along." };
else if (stopped && mind.poked < mind.walked && mind.walked === step.step - 1) { mind.poked = step.step; answer = { do: "press A", thought: "Something is in the way: is it someone to talk to, or something to read?" }; }
else {
  if (stopped) { mind.blocked++; mind.dir = TURN[mind.dir]!; if (mind.blocked % 4 === 0) mind.dir = TURN[mind.dir]!; } // a second turn now and then, so it leaves corners
  mind.walked = step.step;
  answer = { do: `walk ${mind.dir}:${1 + ((step.step * 7) % 5)}`, thought: `${stopped ? "That way is shut. " : ""}Walking ${mind.dir.toLowerCase()} from ${step.where.x},${step.where.y}.` };
}
console.log(JSON.stringify({ ...answer, notes: JSON.stringify(mind) }));
