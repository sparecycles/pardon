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

import Services, {
  CollectionItemInfo,
} from "../components/collection/Services.tsx";
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSelector,
  createSignal,
  Match,
  on,
  Show,
  Switch,
  untrack,
  VoidProps,
} from "solid-js";
import CodeMirror, {
  EditorView,
} from "../components/codemirror/CodeMirror.tsx";
import Resizable from "@corvu/resizable";
import DataInput from "../components/DataInput.tsx";
import { executionMemo } from "../signals/pardon-execution-signal.ts";

import {
  CURL,
  HTTP,
  HTTPS,
  HttpsRequestStep,
  HttpsResponseStep,
  KV,
} from "pardon/formats";
import Toggle from "../components/Toggle.tsx";

import { manifest } from "../signals/pardon-config.ts";
import AssetEditor from "../components/editor/AssetEditor.tsx";
import { ConfigurationDrawer } from "../components/ConfigurationDrawer.tsx";
import RequestHistory from "../components/RequestHistory.tsx";
import MultiView from "../components/MultiView.tsx";
import RecallSystem from "../components/RecallSystem.tsx";
import CornerControls from "../components/CornerControls.tsx";
import { makePersisted } from "@solid-primitives/storage";
import { secureData } from "../components/secure-data.ts";
import { Text } from "@codemirror/state";
import { persistJson } from "../util/persistence.ts";

import { animation } from "../components/animate.ts";
import KeyValueCopier, {
  KeyValueCopierWidget,
  KvEntry,
  makeKeyValueCopierContext,
} from "../components/KeyValueCopier.tsx";
import settle from "../util/settle.ts";
import { updateActiveTrace } from "../components/request-history.ts";

void animation; // used with use:animation

export default function Main(
  props: VoidProps<{
    manifest: ReturnType<typeof manifest>;
  }>,
) {
  const [subPanelView, setSubPanelView] = makePersisted(
    createSignal<"history" | "recall" | "editor">("history"),
    { name: "view", ...persistJson },
  );
  const [redacted, setRedacted] = createSignal(true);
  const [relock, setRelock] = createSignal(true);
  const [includeHeaders, setIncludeHeaders] = createSignal(true);
  const [curl, setCurl] = createSignal(false);

  const [values, setValues] = makePersisted(createSignal({}), {
    name: "values",
    ...persistJson,
  });

  const [http, setHttp] = makePersisted(
    createSignal<string>(props.manifest.example.request ?? ""),
    { name: "http", ...persistJson },
  );

  const [scratchValues, setScratchValues] = makePersisted(
    createSignal<KvEntry[]>([]),
    { name: "scratch", ...persistJson },
  );

  const [history, setHistory] = createSignal<ExecutionHistory>();

  const [currentExecutionSource, setCurrentExecutionSource] =
    createSignal<PardonExecutionSource>({
      http: untrack(http),
      values: { ...values() },
    });

  createEffect(
    on(
      [http, values],
      ([http, values]) => {
        setCurrentExecutionSource({
          http,
          values,
        });
      },
      { defer: true },
    ),
  );

  createEffect(
    on(currentExecutionSource, ({ http, values }) => {
      setHistory(undefined);
      setHttp(http);
      setValues(values);
    }),
  );

  createEffect(() => relock() && setRedacted(true));

  const displayedExecutionSource = createMemo(() => {
    const currentHistory = history();
    if (!currentHistory) {
      return currentExecutionSource();
    }

    const {
      [KV.eoi]: _,
      [KV.upto]: __,
      [KV.unparsed]: http,
      ...values
    } = KV.parse(currentHistory.context.ask, "stream");

    return { http, values };
  });

  const httpInitialValue = createMemo(
    () => props.manifest.example.request ?? "",
  );

  const [collectionItem, setCollectionItem] = createSignal<
    CollectionItemInfo & { key: string }
  >();

  function restoreFromLog(content: string) {
    const scheme = HTTPS.parse(content, "log");

    const requestStep = scheme.steps[0] as HttpsRequestStep;
    const responseStep = scheme.steps[1] as HttpsResponseStep;

    const request = HTTP.stringify(requestStep.request);

    const response = {
      ...responseStep,
      headers: [...new Headers(responseStep.headers)],
      status: Number(responseStep.status),
    };

    setHistory({
      context: {
        trace: -1,
        ask: request,
      },
      outbound: {
        request: {
          ...HTTP.requestObject.json(HTTP.parse(request)),
          values: requestStep.values,
        },
      },
      inbound: {
        response,
        values: {},
      },
      endpoint: undefined!,
      outcome: undefined!,
    });
  }

  function restoreFromHttp(content: string, values?: Record<string, unknown>) {
    const parsed = HTTP.parse(content);
    if (!parsed.origin && !parsed.values.endpoint) {
      return false;
    }
    const reformatted = HTTP.stringify({
      ...parsed,
      values: { ...parsed.values, ...values },
    });
    setHttpInput(reformatted);
    return true;
  }

  createEffect(
    on(
      manifest,
      () => {
        setCurrentExecutionSource(({ values: { ...values }, ...source }) => ({
          values,
          ...source,
        }));
      },
      { defer: true },
    ),
  );

  const currentExecution = executionMemo(currentExecutionSource);

  const [contextResource] = createResource(
    currentExecution,
    async ({ context }) => {
      return await settle(context);
    },
  );

  const [previewResource] = createResource(
    currentExecution,
    async ({ preview }) => {
      return await settle(preview);
    },
  );

  const [requestResource] = createResource(
    currentExecution,
    async ({ request }) => {
      return await settle(request);
    },
  );

  const [responseResource] = createResource(
    currentExecution,
    async ({ response }) => {
      return await settle(response);
    },
  );

  function restoreFromHistory(history: ExecutionHistory) {
    if (history && requestResource.state === "ready") {
      const currentRequestResult = requestResource();

      if (currentRequestResult.status === "fulfilled") {
        const currentRequest = currentRequestResult.value;

        if (currentRequest.context.trace === history.context.trace) {
          setHistory(undefined);
          return;
        }
      }
    }

    setHistory(history);
  }

  const requestContent = createMemo<string>((previous) => {
    if (requestResource.state !== "ready") {
      return previous ?? "loading";
    }

    const request = requestResource();
    if (request.status === "rejected") {
      switch (true) {
        case previewResource.state === "ready" &&
          previewResource.latest.status === "fulfilled":
          return `
Error rendering
---
${previewResource.latest.value.http}
---
${request.reason}`;
        default:
          return `Error rendering
---
${request.reason}          
`;
      }
    }

    const requestObject = HTTP.requestObject.fromJSON(
      redacted()
        ? request.value.outbound.request
        : (
            request.value.secure ??
            secureData()[request.value.context.trace] ??
            request.value
          ).outbound.request,
    );

    if (curl()) {
      return CURL.stringify(requestObject, {
        include: includeHeaders(),
      });
    }

    return HTTP.stringify(requestObject);
  });

  const responseInbound = createMemo(() => {
    const historical = history();

    if (!historical?.inbound && responseResource.state !== "ready") {
      return { error: "loading" };
    }

    if (historical) {
      return historical;
    }

    const response = responseResource();
    if (response.status === "rejected") {
      return {
        error: String(response.reason).replace(
          /^Error: Error invoking remote method 'pardon':\s+/,
          "",
        ),
      };
    }

    return response.value;
  });

  function isErrorResponse(x: any): x is { error: any } {
    return typeof x?.error !== "undefined";
  }

  const responseContent = createMemo<string>(() => {
    const currentInbound = responseInbound();
    if (isErrorResponse(currentInbound)) {
      return currentInbound.error;
    }

    const displayedResponse = (
      redacted()
        ? currentInbound
        : (secureData()[currentInbound.context.trace] ?? currentInbound)
    )?.inbound?.response;

    if (!displayedResponse) {
      return "no response";
    }

    const responseObject = HTTP.responseObject.fromJSON(displayedResponse);

    return HTTP.responseObject.stringify({
      ...responseObject,
      ...(includeHeaders() ? {} : { headers: new Headers() }),
    });
  });

  let httpInputEditorView: EditorView;
  let setHttpInput: (text: string) => void;

  const asset = createMemo(() => collectionItem()?.id);
  const selection = createMemo(() => collectionItem()?.key);
  const current = createMemo(() => {
    const resolved = previewResource.latest;
    if (resolved?.status === "fulfilled") {
      return `endpoint:${resolved.value.endpoint}`;
    }
    const key = collectionItem()?.key;
    if (key?.startsWith("endpoint:")) return key;
  });

  const scratchValuesContext = makeKeyValueCopierContext(scratchValues());

  createEffect(
    on(scratchValuesContext.data, (data) => setScratchValues(data), {
      defer: true,
    }),
  );

  const scratchDropTarget = {
    onDragOver(event) {
      if (
        event.dataTransfer.types.some((type) =>
          ["text/value", "text/plain"].includes(type),
        )
      ) {
        event.preventDefault();
      }
    },
    onDrop(event) {
      if (scratchValuesContext.controls.drop(event.dataTransfer)) {
        event.preventDefault();
      }
    },
  };

  const active = createMemo(() => {
    const result = previewResource.latest;
    if (result?.status == "fulfilled") {
      return new Set(
        ([result.value.configuration.mixin].flat(1) || []).map(
          (mixin) => `mixin:${mixin}`,
        ),
      );
    }

    return new Set<string>();
  });

  const currentTrace = createMemo((previousTrace) => {
    const currentHistory = history();
    if (currentHistory) {
      return Number(currentHistory.context.trace);
    }

    if (requestResource.state !== "ready") {
      return previousTrace;
    }

    const render = requestResource.latest;
    if (render?.status !== "fulfilled") {
      return;
    }

    const request = render?.value;

    return request.context.trace;
  });

  createMemo(() => {
    if (contextResource.state === "ready") {
      const contextValue = contextResource();
      if (contextValue.status === "fulfilled") {
        updateActiveTrace(contextValue.value?.trace);
      }
    }
  });

  const requestNotReady = createMemo(() => {
    return (
      requestResource.state !== "ready" ||
      requestResource().status !== "fulfilled" ||
      currentExecution().progress !== "pending"
    );
  });

  const requestDisabled = createMemo<boolean>((previous) => {
    return requestResource.state !== "ready"
      ? previous
      : requestResource.state === "ready" &&
          (requestResource().status === "rejected" ||
            ["inflight", "complete", "failed"].includes(
              currentExecution()?.progress,
            ));
  });

  const newRequestDisabled = createMemo<boolean>((wasDisabled) => {
    return (
      requestDisabled() ||
      (requestResource.state === "ready" &&
      currentExecution().progress === "pending"
        ? false
        : wasDisabled)
    );
  });

  return (
    <Resizable orientation="vertical">
      <Resizable.Panel
        class="flex size-full min-h-0 flex-1 flex-col"
        initialSize={0.7}
      >
        <Resizable orientation="horizontal">
          <Resizable.Panel initialSize={0.2}>
            <Services
              selection={selection()}
              filters={{
                endpoint: true,
                other: true,
                flow: false,
              }}
              expanded={new Set()}
              endpoint={current()}
              active={active()}
              onClick={(key, info, event) => {
                const { type, archetype: preview } = info ?? {};

                setCollectionItem({ ...info, key });

                if (event.metaKey) {
                  setSubPanelView("editor");
                } else if (type === "endpoint") {
                  if (!http().trim()) {
                    setHttp(preview);
                  }
                }
              }}
              onDblClick={(key, info) => {
                const { type, archetype: preview } = info ?? {};

                batch(() => {
                  setCollectionItem({ ...info, key });
                  if (type === "endpoint") {
                    restoreFromHttp(preview, values());
                  }
                });
              }}
            />
          </Resizable.Panel>
          <Resizable.Handle />
          <Resizable.Panel initialSize={0.8}>
            <Resizable orientation="vertical">
              <Resizable.Panel
                class="flex flex-col bg-neutral-200 dark:bg-neutral-600"
                minSize={0.3}
                initialSize={0.5}
                collapsedSize={0.25}
                collapsible
              >
                <Resizable>
                  <Resizable.Panel
                    minSize={0.1}
                    initialSize={0.6}
                    class="flex flex-grow-0 flex-col"
                  >
                    <DataInput
                      class="w-0 min-w-full flex-1 overflow-auto bg-yellow-100 dark:bg-stone-700 [&_.cm-line]:pr-8"
                      editorViewRef={(view) => (httpInputEditorView = view)}
                      defaultValue={httpInitialValue()}
                      setTextRef={(setText) => (setHttpInput = setText)}
                      data={{
                        values,
                        doc: http,
                      }}
                      nowrap
                      onDataChange={({ values, doc }) => {
                        setCurrentExecutionSource({
                          http: doc,
                          values,
                        });
                      }}
                      oncapture:paste={(event) => {
                        const text = event.clipboardData.getData("text/plain");

                        // try to delete all selected data from the doc
                        // if the result is empty, we will apply all the
                        // magic formatting.
                        let { doc, selection } = httpInputEditorView.state;
                        for (const range of [...selection.ranges].reverse()) {
                          doc = doc.replace(
                            range.from,
                            range.to,
                            Text.of([""]),
                          );
                        }

                        if (doc.toString().trim()) {
                          // skip magic paste formatting,
                          // doc not empty
                          return;
                        }

                        if (text) {
                          try {
                            if (text.trim().startsWith(">>>")) {
                              restoreFromLog(text);
                              event.preventDefault();
                            } else if (restoreFromHttp(text)) {
                              event.preventDefault();
                            }
                          } catch (error) {
                            console.warn(
                              "could not reformat pasted data",
                              error,
                            );
                          }
                        }
                      }}
                      overlay={
                        <>
                          <CornerControls
                            placement="tr"
                            flex="col"
                            class="z-10 gap-1 bg-stone-200 p-0.5 dark:bg-slate-600"
                            unbuttoned={["info"]}
                            actions={{
                              copy: () => {
                                navigator.clipboard.writeText(
                                  `${KV.stringify({ ...currentExecutionSource().values }, "\n", 2, "\n\n")}${http()}`,
                                );
                              },
                            }}
                            icons={{
                              info: (
                                <ConfigurationDrawer
                                  class="!text-md flex bg-inherit p-0"
                                  preview={createMemo(() => {
                                    return previewResource?.state === "ready"
                                      ? previewResource()
                                      : undefined;
                                  })()}
                                >
                                  <IconTablerSettings2 />
                                </ConfigurationDrawer>
                              ),
                              copy: <IconTablerCopy />,
                            }}
                          />
                        </>
                      }
                      dragDrop={{
                        onDragOver(event) {
                          const { types } = event.dataTransfer;
                          if (
                            types.includes("text/http") ||
                            types.includes("text/log")
                          ) {
                            return true;
                          }
                        },
                        onDrop(event) {
                          const http = event.dataTransfer.getData("text/http");

                          if (http) {
                            restoreFromHttp(http, values());
                            event.preventDefault();
                            return;
                          }

                          const log = event.dataTransfer.getData("text/log");

                          if (log) {
                            restoreFromLog(log);
                            event.preventDefault();
                            return;
                          }
                        },
                      }}
                    />
                  </Resizable.Panel>
                </Resizable>
              </Resizable.Panel>
              <Resizable.Handle />
              <Resizable.Panel class="flex flex-col">
                {() => {
                  return (
                    <>
                      <div class="flex size-0 min-h-full min-w-full flex-row">
                        <MultiView
                          view={"outbound"}
                          controls={{
                            preview: <IconTablerCode />,
                            outbound: <IconTablerUpload />,
                            inbound: <IconTablerDownload />,
                            values: <IconTablerReceipt />,
                          }}
                          disabled={{
                            preview: Boolean(history()),
                            inbound:
                              !history() && responseResource.state !== "ready",
                            values:
                              !history() &&
                              (responseResource.state !== "ready" ||
                                responseResource().status !== "fulfilled"),
                          }}
                          defaulting={() => [
                            "outbound",
                            "inbound",
                            "preview",
                            "values",
                          ]}
                          class="flex size-full flex-col"
                        >
                          {([view, setView]) => {
                            const requestUri = createMemo(() => {
                              const currentHistory = history();
                              if (currentHistory) {
                                const { method, url } =
                                  currentHistory.outbound.request;
                                return { method, url };
                              }

                              var rendered =
                                requestResource.latest?.status === "fulfilled"
                                  ? requestResource.latest.value
                                  : previewResource.latest?.status ===
                                      "fulfilled"
                                    ? previewResource.latest.value
                                    : null;
                              if (rendered) {
                                const {
                                  method,
                                  origin,
                                  pathname,
                                  searchParams,
                                } = HTTP.parse(rendered.http);

                                return {
                                  method,
                                  url: `${origin}${pathname}${searchParams}`,
                                };
                              }

                              return { method: null, url: "" };
                            });

                            const currentPreview = createMemo(
                              (previousRequest: string) => {
                                if (previewResource.state !== "ready") {
                                  if (
                                    previewResource.state === "refreshing" ||
                                    previewResource.state === "pending"
                                  ) {
                                    return previousRequest ?? "";
                                  }

                                  return "";
                                }

                                const previewResult = previewResource();
                                if (previewResult.status === "fulfilled") {
                                  return previewResult.value.http;
                                }

                                if (!previewResult.reason) {
                                  return "";
                                }

                                try {
                                  const { action, step, stack } = JSON.parse(
                                    previewResult.reason,
                                  );
                                  if (step === "sync") {
                                    return previousRequest ?? "";
                                  }
                                  return `${action}@${step}\n${stack}`;
                                } catch (oops) {
                                  void oops;
                                  return String(previewResult.reason);
                                }
                              },
                            );

                            const latestRequest = createMemo(() => {
                              if (requestResource.state !== "ready") {
                                return;
                              }

                              const request = requestResource();

                              if (request.status !== "fulfilled") {
                                const error = request.reason;
                                return { error } as PardonExecutionRender;
                              }

                              return request.value;
                            });

                            const currentRequest = createMemo(
                              (previousRequest: string) => {
                                const { outbound, context, error } =
                                  history() ?? latestRequest() ?? {};

                                if (error && !outbound) {
                                  return error;
                                }

                                if (!outbound) {
                                  if (
                                    requestResource.state === "refreshing" ||
                                    requestResource.state === "pending"
                                  ) {
                                    return previousRequest ?? "";
                                  }

                                  return "";
                                }

                                const requestObject =
                                  HTTP.requestObject.fromJSON({
                                    ...(redacted()
                                      ? outbound
                                      : (secureData()[context.trace]
                                          ?.outbound ?? outbound)
                                    )?.request,
                                    values: {},
                                  });

                                if (curl()) {
                                  return CURL.stringify(requestObject, {
                                    include: includeHeaders(),
                                  });
                                }

                                return HTTP.stringify(requestObject);
                              },
                            );

                            return (
                              <>
                                <div class="flex w-full min-w-0 flex-initial flex-row gap-1 p-2 pr-8">
                                  <MultiView.Controls class="aspect-square flex-initial p-1 text-xl [&.multiview-selected]:bg-lime-400 [&.multiview-selected]:dark:bg-cyan-500" />
                                  <button
                                    class="w-0 flex-1 border-1 border-gray-300 bg-gray-400 bg-transparent px-2 py-0 text-start light:text-neutral-700 dark:text-neutral-200 disabled:dark:text-neutral-400"
                                    disabled={newRequestDisabled()}
                                    classList={{
                                      "light:bg-orange-300 dark:bg-yellow-900":
                                        ["POST", "PUT", "DELETE"].includes(
                                          requestUri().method,
                                        ),
                                      "light:bg-green-300 dark:bg-green-900": [
                                        "GET",
                                        "HEAD",
                                        "OPTIONS",
                                      ].includes(requestUri().method),
                                      "light:bg-red-300 dark:bg-fuchsia-900": [
                                        "DELETE",
                                      ].includes(requestUri().method),
                                    }}
                                    onClick={() => {
                                      if (requestNotReady()) {
                                        return;
                                      }

                                      currentExecution()?.send();
                                      setView((tab) =>
                                        ["outbound", "preview"].includes(tab)
                                          ? "inbound"
                                          : tab,
                                      );
                                    }}
                                  >
                                    <div class="flex flex-row place-content-start gap-2 font-mono">
                                      <span>{requestUri().method}</span>
                                      <span class="my-1 w-[1px] bg-current"></span>
                                      <span class="overflow-hidden overflow-ellipsis whitespace-nowrap">
                                        {requestUri().url}
                                      </span>
                                      <Show
                                        when={
                                          responseResource.state === "ready" &&
                                          responseResource.latest?.status ===
                                            "fulfilled"
                                        }
                                      >
                                        <span class="flex-1 text-end light:text-black dark:text-white">
                                          {responseResource.state === "ready" &&
                                          responseResource.latest?.status ===
                                            "fulfilled"
                                            ? String(
                                                responseResource.latest.value
                                                  .inbound.response.status,
                                              )
                                            : "???"}
                                        </span>
                                      </Show>
                                    </div>
                                  </button>

                                  <button
                                    class="ml-1.5 aspect-square flex-initial p-1 text-xl"
                                    onclick={() =>
                                      batch(() => {
                                        const { http, values } =
                                          displayedExecutionSource();

                                        console.log("restore", http, values);
                                        setHttp(http);
                                        setValues({ ...values });

                                        setView((view) => {
                                          if (view === "inbound") {
                                            return "outbound";
                                          }
                                          return view;
                                        });
                                      })
                                    }
                                  >
                                    <Switch
                                      fallback={
                                        <span
                                          use:animation={[
                                            "animate-cw-spin",
                                            () => requestResource?.loading,
                                          ]}
                                          class="smoothed-backdrop !bg-opacity-50"
                                        >
                                          <IconTablerReload />
                                        </span>
                                      }
                                    >
                                      <Match when={history()}>
                                        <IconTablerPencil />
                                      </Match>
                                    </Switch>
                                  </button>
                                </div>
                                <Switch>
                                  <Match when={view() == "preview"}>
                                    <CodeMirror
                                      readonly
                                      nowrap
                                      value={currentPreview()}
                                      class="flex-1 [&_.cm-content]:pr-6"
                                    />
                                  </Match>
                                  <Match when={view() == "outbound"}>
                                    <CodeMirror
                                      readonly
                                      nowrap
                                      value={currentRequest()}
                                      disabled={requestDisabled()}
                                      class="flex-1 [&_.cm-content]:pr-6"
                                    />
                                  </Match>
                                  <Match when={view() == "inbound"}>
                                    <CodeMirror
                                      value={responseContent()}
                                      readonly
                                      nowrap
                                      class="flex-1 [&_.cm-content]:pr-6"
                                    />
                                  </Match>
                                  <Match when={view() == "values"}>
                                    <KeyValueCopier
                                      class="p-1"
                                      readonly
                                      values={
                                        history()
                                          ? history().inbound?.values
                                          : responseResource.latest?.status ===
                                              "fulfilled"
                                            ? responseResource.latest.value
                                                .inbound.values
                                            : {}
                                      }
                                    />
                                  </Match>
                                </Switch>
                              </>
                            );
                          }}
                        </MultiView>
                        <CornerControls
                          class="z-10 gap-1 bg-gray-300 p-0.5 dark:bg-gray-600"
                          placement="tr"
                          flex="col"
                          actions={{
                            redacted: () => setRedacted((value) => !value),
                            copy() {
                              navigator.clipboard.writeText(requestContent());
                            },
                            curl: () => setCurl((value) => !value),
                            include: () => setIncludeHeaders((value) => !value),
                          }}
                          icons={{
                            redacted: redacted() ? (
                              <IconTablerEyeClosed />
                            ) : (
                              <IconTablerEye />
                            ),
                            curl: curl() ? (
                              <IconTablerCopyright />
                            ) : (
                              <IconTablerSend />
                            ),
                            include: includeHeaders() ? (
                              <IconTablerInfoCircle />
                            ) : (
                              <span class="relative flex">
                                <IconTablerInfoOctagon class="z-10" />
                                <IconTablerInfoOctagonFilled class="absolute text-red-300 dark:text-red-800" />
                              </span>
                            ),
                            copy: <IconTablerCopy />,
                          }}
                          disabled={{
                            redacted: relock(),
                            copy:
                              requestResource.latest?.status !== "fulfilled",
                          }}
                        />
                      </div>
                    </>
                  );
                }}
              </Resizable.Panel>
            </Resizable>
          </Resizable.Panel>
        </Resizable>
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel initialSize={0.3}>
        <MultiView
          view={subPanelView()}
          onChange={setSubPanelView}
          controls={
            {
              history: <IconTablerMist />,
              recall: (
                <div class="relative">
                  <IconTablerQuestionMark class="absolute" />
                  <IconTablerExclamationMark />
                </div>
              ),
              scratch: <IconTablerReceipt />,
              editor: <IconTablerPencil />,
            } as const
          }
          controlProps={{
            scratch: scratchDropTarget,
          }}
          class="mih-h-0 size-full"
        >
          {([view]) => (
            <div class="relative flex size-full flex-1 flex-row">
              <div class="flex min-h-0 flex-col gap-1 border-r-1 border-neutral-300 p-1 dark:border-neutral-500">
                <MultiView.Controls class="flex flex-initial flex-col p-1 text-xl [&.multiview-selected]:bg-lime-400 [&.multiview-selected]:dark:bg-cyan-500" />
                <Toggle
                  class="relative mt-auto bg-inherit p-1 text-xl mix-blend-normal dark:active:!bg-neutral-500"
                  onChange={setRelock}
                  value={relock()}
                >
                  {(props) => (
                    <>
                      {props.value ? (
                        <IconTablerLock class="scale-150 dark:text-neutral-400" />
                      ) : (
                        <IconTablerLockOpen class="scale-150 dark:text-neutral-400" />
                      )}
                      <IconTablerEye class="absolute bottom-[-1px] scale-75" />
                    </>
                  )}
                </Toggle>
              </div>
              <Resizable class="">
                <Resizable.Panel
                  initialSize={0.8}
                  class="flex size-0 min-h-full min-w-full flex-1"
                >
                  <Switch>
                    <Match when={view() === "editor"}>
                      <AssetEditor id={asset()} />
                    </Match>
                    <Match when={view() == "history"}>
                      <RequestHistory
                        onRestore={restoreFromHistory}
                        isCurrent={createSelector(currentTrace)}
                      />
                    </Match>
                    <Match when={view() == "recall"}>
                      <RecallSystem
                        onRestore={restoreFromHistory}
                        isCurrent={createSelector(currentTrace)}
                      />
                    </Match>
                    <Match when={view() === "scratch"}>
                      <KeyValueCopierWidget
                        class="flex size-0 min-h-full min-w-full overflow-auto bg-neutral-200 p-1 dark:bg-stone-800"
                        {...scratchDropTarget}
                        context={scratchValuesContext}
                      >
                        {({ data, deleteDatum, deleteAll }) => {
                          createEffect(
                            on(data, (data) => setScratchValues(data), {
                              defer: true,
                            }),
                          );

                          return (
                            <>
                              <div
                                class="pointer-events-none absolute inset-x-0 bottom-1 flex place-content-center opacity-100 transition-opacity duration-700"
                                classList={{
                                  "!opacity-0":
                                    Object.keys(scratchValues() ?? {}).length ==
                                    0,
                                }}
                              >
                                <button
                                  class="flex-0 pointer-events-auto p-1 transition-colors duration-300 hover:bg-fuchsia-300 dark:hover:bg-pink-500 [&.drop]:!bg-fuchsia-300 [&.drop]:dark:!bg-pink-500"
                                  classList={{
                                    "!pointer-events-none":
                                      Object.keys(scratchValues() ?? {})
                                        .length == 0,
                                  }}
                                  onClick={() => deleteAll()}
                                  onDragOver={(event) => {
                                    if (
                                      event.dataTransfer.types.includes(
                                        "text/value",
                                      )
                                    ) {
                                      event.preventDefault();
                                      event.target.classList.add("drop");
                                    }
                                  }}
                                  onDragEnter={function (event) {
                                    event.target.classList.add("drop");
                                  }}
                                  onDragLeave={function (event) {
                                    event.target.classList.remove("drop");
                                  }}
                                  onDrop={(event) => {
                                    deleteDatum(event.dataTransfer);

                                    // eat the event to prevent reapplying the value.
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                >
                                  <IconTablerTrash class="pointer-events-none" />
                                </button>
                              </div>
                            </>
                          );
                        }}
                      </KeyValueCopierWidget>
                    </Match>
                  </Switch>
                </Resizable.Panel>
              </Resizable>
            </div>
          )}
        </MultiView>
      </Resizable.Panel>
    </Resizable>
  );
}
