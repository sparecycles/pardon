/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import { createMemo, createSignal, on, type Accessor } from "solid-js";
import { deferred, recv, ship } from "pardon/utils";
import { HTTP } from "pardon/formats";

export type ExecutionResult =
  | ({ type: "response" } & Awaited<ReturnType<typeof window.pardon.continue>>)
  | ({ type: "history" } & ExecutionHistory);

export type ExecutionOutboundResult = {
  type: "request" | "history";
  context: { ask: string; trace: number };
} & Omit<Awaited<ReturnType<typeof window.pardon.render>>, "secure">;

export type ExecutionProgress =
  | "history"
  | "preview"
  | "rendering"
  | "pending"
  | "errored"
  | "inflight"
  | "complete"
  | "failed";

export function executionMemo(source: Accessor<PardonExecutionSource>) {
  return createMemo(
    on<
      PardonExecutionSource,
      {
        abort(reason: any): void;
        progress: ExecutionProgress;
        preview: ReturnType<typeof window.pardon.preview>;
        request: Promise<
          Awaited<ReturnType<typeof window.pardon.render>> & {
            type: "history" | "request";
          }
        >;
        response: Promise<
          Awaited<ReturnType<typeof window.pardon.continue>> & {
            type: "history" | "response";
          }
        >;
        send(): void;
      }
    >(source, (source, _previousSource, previous) => {
      const { http, values, history } = source;

      const gates = {
        preview: deferred<boolean>(),
        render: deferred<boolean>(),
        response: deferred<boolean>(),
      };

      const [progress, setProgress] = createSignal<ExecutionProgress>(
        history ? "history" : "preview",
      );

      const abort = (reason) => {
        for (const gate of Object.values(gates)) {
          gate.resolution.reject(reason);
        }
      };

      for (const [type, gate] of Object.entries(gates)) {
        gate.promise.catch((reason) => {
          if (reason) {
            console.log(`${type} aborted`, reason);
          }
        });
      }

      if (previous) {
        previous.abort(undefined);
      }

      const previewTask = (async () => {
        await gates.preview.promise;

        return recv(
          await window.pardon.preview(http, ship(values), {
            pretty: true,
          }),
        );
      })();

      const renderTask = (async () => {
        await gates.render.promise;

        setProgress("rendering");

        try {
          const result = recv(
            await window.pardon.render(http, ship(values), {
              pretty: true,
            }),
          );

          setProgress("pending");

          return result;
        } catch (error) {
          setProgress("errored");

          throw error;
        }
      })();

      const responseTask = (async () => {
        await gates.response.promise;

        gates.render.resolution.resolve(true);

        const { handle } = await renderTask;

        setProgress("inflight");

        try {
          const result = recv(await window.pardon.continue(handle));
          setProgress("complete");

          return result;
        } catch (error) {
          setProgress("failed");

          throw error;
        }
      })();

      return {
        abort,
        get progress() {
          return progress();
        },
        get preview() {
          if (history) {
            return Promise.reject();
          }

          gates.preview.resolution.resolve(true);

          return previewTask;
        },
        get request() {
          if (history) {
            return Promise.resolve({
              http: HTTP.stringify(
                HTTP.requestObject.fromJSON(history.outbound.request),
              ),
              outbound: history.outbound,
              context: { timestamps: {}, durations: {}, ...history.context },
              secure: undefined!,
              handle: undefined! as string,
              type: "history" as const,
            });
          }

          gates.render.resolution.resolve(true);

          return renderTask.then((result) => ({
            ...result,
            type: "request" as const,
          }));
        },
        send() {
          gates.response.resolution.resolve(true);
        },
        get response() {
          if (history) {
            return Promise.resolve({
              ...history,
              context: { timestamps: {}, durations: {}, ...history.context },
              type: "history" as const,
            });
          }

          return responseTask.then((result) => ({
            ...result,
            type: "response" as const,
          }));
        },
      };
    }),
  );
}
