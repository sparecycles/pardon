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
import {
  Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js";
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

const [history, setHistory] = makePersisted(
  createSignal<{
    traces: Record<number, Trace>;
  }>({ traces: {} }),
  {
    name: "history",
    storage: localforage,
    ...persistJson,
  },
);

setTimeout(() => console.log("history size", history().traces), 1000);

export const [activeTrace, updateActiveTrace] = createSignal<number>();

export function clearAllTraces() {
  setHistory(({ traces }) => {
    const currentTrace = traces?.[activeTrace()];

    if (currentTrace) {
      return { traces: { [activeTrace()]: currentTrace } };
    }

    return {
      traces: {},
    };
  });
}

export function clearTrace(trace: number) {
  setHistory(({ traces: { [trace]: _, ...traces } }) => ({ traces }));
}

export const { traces } = createRoot(() => {
  createEffect(() => {
    window.pardon.registerHistoryForwarder({
      onRenderStart(trace, start) {
        setHistory(({ traces }) => {
          const thisTrace = traces?.[trace];

          return {
            traces: {
              ...traces,
              [trace]: {
                ...thisTrace,
                trace,
                start,
                tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
              },
            },
          };
        });
      },
      onRenderComplete(trace, { secure, ...render }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));
        setHistory(({ traces }) => {
          const thisTrace = traces[trace];
          return {
            traces: {
              ...traces,
              [trace]: {
                ...thisTrace,
                render,
                tlr: thisTrace?.tlr || Number(activeTrace()) == Number(trace),
              },
            },
          };
        });
      },
      onSend(trace) {
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], sent: true } },
        }));
      },
      onResult(trace, { secure, ...result }) {
        setSecureData((data) => ({
          ...data,
          [trace]: { ...data[trace], ...secure },
        }));
        setHistory(({ traces }) => ({
          traces: { ...traces, [trace]: { ...traces[trace], result } },
        }));
      },
      onError(trace, { error }) {
        setHistory(({ traces: { [trace]: record, ...traces } }) => {
          if (!record.render) {
            return { traces };
          }

          return {
            traces: {
              ...traces,
              [trace]: { ...record, error: `${error}` },
            },
          };
        });
      },
    });
  });

  const traces = createMemo(() => history()?.traces ?? {});

  return { traces };
});

export function cancelTrace(trace: number) {
  setHistory(({ traces: { [trace]: cancelled, ...traces } }) => {
    if (trace !== activeTrace()) {
      return {
        traces,
      };
    }

    return {
      traces: {
        ...traces,
        [trace]: {
          ...cancelled,
          cancelled: true,
        },
      },
    };
  });
}

createEffect((previousTrace: number) => {
  const currentTrace = activeTrace();
  if (!traces()?.[currentTrace]?.render) {
    return previousTrace;
  }

  if (currentTrace !== previousTrace && traces()?.[previousTrace]?.cancelled) {
    setHistory(({ traces: { [previousTrace]: previous, ...traces } }) => ({
      traces,
    }));
    return currentTrace;
  }

  return currentTrace;
});

export function requestHistoryForest(currentRequest: number) {
  const allTraces = traces();
  const list = Object.values(allTraces)
    .filter(
      ({ trace, start, render, sent, tlr, cancelled }) =>
        cancelled ||
        ((tlr || start || render) &&
          (currentRequest === Number(trace) || sent)),
    )
    .map(({ trace }) => Number(trace))
    .sort((a, b) => b - a);

  const toplevel = list.filter((id) => {
    const { tlr, cancelled } = allTraces[id] ?? {};

    return tlr || cancelled;
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
    .filter(Boolean);

  return [...known, ...unknown]; //.sort(({ trace: a }, { trace: b }) => b - a);
}

export function requestHistory(currentRequest: Accessor<number>) {
  return createMemo(() => {
    return requestHistoryForest(currentRequest());
  });
}
