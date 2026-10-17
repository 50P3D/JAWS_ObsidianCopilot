import { chatJson } from "./ollama";

const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
console.log(await chatJson<{ answer: string }>("Reply in JSON.", "What is the capital of France?", schema));