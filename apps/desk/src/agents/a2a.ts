import { randomUUID } from "node:crypto";
import { Message, TaskState, type Task } from "@a2a-js/sdk";
import { AgentEvent, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { EXTENSIONS } from "@proviso/sdk";

/** SDK-form parts (the SDK serializes them to A2A v1 wire parts: `{data:{...}}`, `{text}`). */
export const dataPart = (key: string, value: unknown) => ({
  content: { $case: "data" as const, value: { [key]: value } },
  metadata: undefined,
  filename: "",
  mediaType: "application/json",
});

export const textPart = (text: string) => ({
  content: { $case: "text" as const, value: text },
  metadata: undefined,
  filename: "",
  mediaType: "text/plain",
});

export function activateExtensions(rc: RequestContext) {
  for (const uri of Object.values(EXTENSIONS)) {
    if (rc.context.requestedExtensions?.includes(uri)) rc.context.addActivatedExtension(uri);
  }
}

export function agentMessage(rc: RequestContext, text: string): Message {
  return Message.fromJSON({ messageId: randomUUID(), role: "ROLE_AGENT", taskId: rc.taskId, contextId: rc.contextId, parts: [{ text }] });
}

export function status(rc: RequestContext, state: TaskState, text?: string) {
  return { state, timestamp: new Date().toISOString(), message: text ? agentMessage(rc, text) : undefined };
}

/** First event of a turn must be the task (or a message). */
export function publishTask(rc: RequestContext, bus: ExecutionEventBus, state: TaskState, text?: string) {
  const base: Task = rc.task ?? ({ id: rc.taskId, contextId: rc.contextId, artifacts: [], history: [rc.userMessage], metadata: {} } as unknown as Task);
  bus.publish(AgentEvent.task({ ...base, status: status(rc, state, text) } as Task));
}

export function publishStatus(rc: RequestContext, bus: ExecutionEventBus, state: TaskState, text?: string) {
  bus.publish(AgentEvent.statusUpdate({ taskId: rc.taskId, contextId: rc.contextId, metadata: undefined, status: status(rc, state, text) } as never));
}

export function publishArtifact(rc: RequestContext, bus: ExecutionEventBus, a: { id: string; name: string; parts: unknown[] }) {
  bus.publish(
    AgentEvent.artifactUpdate({
      taskId: rc.taskId,
      contextId: rc.contextId,
      append: false,
      lastChunk: true,
      metadata: undefined,
      artifact: { artifactId: a.id, name: a.name, description: "", metadata: undefined, extensions: [EXTENSIONS.ap2], parts: a.parts },
    } as never),
  );
}

export { TaskState };
