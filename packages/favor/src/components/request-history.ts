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

import { makePersisted } from "@solid-primitives/storage";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { HistoryTree } from "./RequestSummaryTree.tsx";
import { persistJson } from "../util/persistence.ts";
import localforage from "localforage";
import { setSecureData } from "./secure-data.ts";

type TracingHookPayloads = any;
export type Trace = {
  trace: number;
  tlr?: boolean; // top-level-request
  sent?: true;
  cancelled?: true;
  start: TracingHookPayloads["onRenderStart"]["trace"];
  render?: TracingHookPayloads["onRenderComplete"]["trace"];
  error?: TracingHookPayloads["onError"]["trace"];
  result?: TracingHookPayloads["onResult"]["trace"];
};

const [history, setHistory, initHistory] = makePersisted(
  createSignal<{
    traces: Record<number, Trace>;
  }>({ traces: {} }),
  {
    name: "history",
    storage: localforage,
    ...persistJson,
  },
);

export const [traces, setTraces] = createSignal<Record<number, Trace>>({});
export const [activeTrace, updateActiveTrace] = createSignal<number>();

Promise.resolve(initHistory).then((historyJson) => {
  const history = historyJson ? JSON.parse(historyJson) : { traces: {} };

  setTraces({ ...history.traces, ...traces });
});

// create global effects inside a createRoot to avoid a warning.
createRoot(() => {
  createEffect(() => {
    window.pardon.registerHistoryForwarder({
      onRenderStart(trace, start) {
        setTraces((traces) => {
          const thisTrace = traces?.[trace];

          return {
            ...traces,
            [trace]: {
              ...thisTrace,
              trace,
              start,
              tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
            },
          };
        });
      },
      onRenderComplete(trace, { secure, ...render }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));

        setTraces((traces) => {
          const thisTrace = traces[trace];
          return {
            ...traces,
            [trace]: {
              ...thisTrace,
              render,
              tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
            },
          };
        });
      },
      onSend(trace) {
        setTraces((traces) => ({
          ...traces,
          [trace]: { ...traces[trace], sent: true },
        }));
      },
      onResult(trace, { secure, ...result }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));

        setTraces((traces) => {
          const combinedTraces = {
            ...traces,
            [trace]: { ...traces[trace], result },
          };

          setHistory(() => ({
            traces: combinedTraces,
          }));

          return combinedTraces;
        });
      },
      onError(trace, { error }) {
        setTraces(({ [trace]: record, ...traces }) => {
          if (record?.render) {
            const combinedTraces = {
              ...traces,
              [trace]: { ...record, error },
            };

            setHistory(() => ({
              traces: combinedTraces,
            }));

            return combinedTraces;
          }

          return traces;
        });
      },
    });
  });

  createEffect((previousTraceId: number) => {
    const currentTraceId = activeTrace();
    const currentTrace = traces()?.[currentTraceId];
    if (!currentTrace?.render) {
      return previousTraceId;
    }

    if (
      currentTraceId !== previousTraceId &&
      traces()?.[previousTraceId]?.cancelled
    ) {
      setTraces(({ [previousTraceId]: previous, ...traces }) => traces);

      return currentTraceId;
    }

    return currentTraceId;
  });
});

setTimeout(() => console.log("history size", history().traces), 1000);

export function clearAllTraces() {
  setTraces({});

  setHistory({
    traces: {},
  });
}

export function clearTrace(trace: number) {
  setTraces(({ [trace]: _, ...traces }) => {
    return traces;
  });

  setHistory(({ traces: { [trace]: _, ...traces } }) => {
    return { traces };
  });
}

export function cancelTrace(trace: number) {
  setTraces(({ [trace]: cancelled, ...traces }) => {
    if (trace !== activeTrace()) {
      return {
        traces,
      };
    }

    return {
      ...traces,
      [trace]: {
        ...cancelled,
        cancelled: true,
      },
    };
  });
}

export function requestHistoryForest() {
  const allTraces = traces();
  const list = Object.values(allTraces)
    .filter(
      ({ start, render, sent, tlr, cancelled }) =>
        !cancelled && (tlr || start || render) && sent,
    )
    .map(({ trace }) => Number(trace))
    .sort((a, b) => b - a);

  const toplevel = list.filter((id) => {
    const { tlr, cancelled } = allTraces[id] ?? {};

    return tlr && !cancelled;
  });

  const seen = new Set<number>();

  function visit(
    trace: number,
    perRequest: Set<number> = new Set(),
  ): HistoryTree {
    if (perRequest.has(trace)) {
      return;
    }

    perRequest.add(trace);
    seen.add(trace);

    return {
      trace,
      deps: [...(allTraces[trace]?.render?.awaited.results || [])]
        .reverse()
        .filter((trace) => traces()[trace])
        .map((trace) => visit(trace, perRequest))
        .filter(Boolean),
    };
  }

  const known = toplevel.map((trace) => visit(trace)).filter(Boolean);

  const sharedPerRequest = new Set<number>();
  const unknown = list
    .map(
      (trace) =>
        !seen.has(trace) &&
        !sharedPerRequest.has(trace) &&
        visit(trace, sharedPerRequest),
    )
    .filter(Boolean)
    .map<HistoryTree>((info) => ({ ...info, auto: true }));

  return [...known, ...unknown].sort(({ trace: a }, { trace: b }) => b - a);
}

export function requestHistory() {
  return createMemo(requestHistoryForest);
}
