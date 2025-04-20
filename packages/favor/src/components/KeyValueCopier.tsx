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

import { JSON, KV } from "pardon/formats";
import {
  ComponentProps,
  For,
  splitProps,
  JSX,
  createSignal,
  Accessor,
  untrack,
  createEffect,
  on,
  Show,
} from "solid-js";
import { twMerge } from "tailwind-merge";

export type KvEntry = readonly [string, unknown, string?];

type KvCopierControl = {
  data: Accessor<KvEntry[]>;
  addValues(kv: Record<string, unknown>): void;
  containsDatum(transfer: DataTransfer): boolean;
  drop(transfer: DataTransfer): true | void;
  deleteDatum(transfer: DataTransfer): void;
  deleteAll(): void;
};

type KeyValueCopierContext = ReturnType<typeof makeKeyValueCopierContext>;

export function makeKeyValueCopierContext(initialData?: KvEntry[]) {
  const source = crypto.randomUUID();
  const [data, setData] = createSignal<KvEntry[]>(initialData ?? []);

  function addValues(kv: Record<string, unknown>) {
    setData((data) => [
      ...data,
      ...Object.entries(kv ?? {}).map(
        ([k, v]) => [k, v, crypto.randomUUID()] as KvEntry,
      ),
    ]);
  }

  function containsDatum(transfer: DataTransfer) {
    const info = parseId(transfer);

    return (
      source === info?.source &&
      Boolean(data().find(([, , id]) => id == info.id))
    );
  }

  const controls: KvCopierControl = {
    data,
    addValues,
    deleteDatum(transfer: DataTransfer) {
      const info = parseId(transfer);
      if (info?.source !== source) {
        return;
      }

      setData((data) => data.filter(([, , id]) => id != info.id));
    },
    containsDatum,
    deleteAll() {
      setData([]);
    },
    drop(dataTransfer) {
      const kvData = dataTransfer.getData("text/value");

      if (kvData) {
        if (containsDatum(dataTransfer)) {
          return;
        }

        const data = KV.parse(kvData, "object");

        addValues(data);
        return true;
      }

      const data = dataTransfer.getData("text/plain");
      try {
        addValues(KV.parse(data, "object"));
        return;
      } catch (error) {
        void error;
        // continue
      }

      try {
        const json = JSON.parse(data);
        if (typeof json === "object") {
          addValues(json);
        }
      } catch (error) {
        void error;
        // continue
      }
    },
  };

  return {
    addValues,
    data,
    setData,
    containsDatum,
    controls,
    source,
  };
}

export default function KeyValueCopier(
  props: Omit<ComponentProps<"div">, "children"> & {
    initialData?: KvEntry[];
    readonly?: boolean;
    noIcon?: boolean;
    values?: Record<string, unknown>;
    init?(
      copier: KvCopierControl,
    ): Omit<Partial<ComponentProps<"div">>, "children">;
    children?(copier: KvCopierControl): JSX.Element;
  },
) {
  const [, restProps] = splitProps(props, [
    "initialData",
    "readonly",
    "values",
  ]);

  const context = makeKeyValueCopierContext(untrack(() => props.initialData));

  const { setData, addValues } = context;

  if (props.readonly) {
    createEffect(
      on(
        () => props.values,
        (values) => {
          if (values) {
            setData([]);
            addValues(values);
          }
        },
      ),
    );
  }
  return <KeyValueCopierWidget {...restProps} context={context} />;
}

export function KeyValueCopierWidget(
  props: Omit<ComponentProps<"div">, "children"> & {
    context: KeyValueCopierContext;
    noIcon?: boolean;
    children?(copier: KvCopierControl): JSX.Element;
  },
) {
  const [, divProps] = splitProps(props, ["context", "children"]);

  const { source, data, controls } = untrack(() => props.context);

  return (
    <div
      {...divProps}
      class={twMerge(
        "relative flex flex-1 overflow-hidden [&:has(.copyable-object>.key:hover,.copyable-value:hover,.variable>.key:hover)>.copy-icon]:opacity-50",
        props.class,
      )}
      classList={props.classList}
    >
      <div class="flex flex-1 flex-col overflow-auto whitespace-pre">
        <For each={data()}>
          {([key, value, id]) => (
            <div class="whitespace-pre font-mono" onClick={() => {}}>
              <KeyValueCopierNode
                id={id + "/" + source}
                tokens={KV.tokenize(KV.stringify({ [key]: value }, "\n", 2))}
              />
            </div>
          )}
        </For>
      </div>
      <Show when={!props.noIcon}>
        <span class="copy-icon absolute right-1 top-[50%] flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
          <IconTablerCopy />
        </span>
        <span class="value-icon absolute right-1 top-[50%] flex translate-y-[-50%] rounded-lg border-1 p-1 text-xl opacity-0 transition-opacity duration-150 dark:bg-neutral-600">
          <IconTablerPlus />
        </span>
      </Show>
      {props.children?.(controls)}
    </div>
  );
}

function KeyValueCopierNode(props: {
  id?: string;
  tokens: { token: string; span?: number; key?: string; value?: unknown }[];
}) {
  const [key, ...eqvalue] = props.tokens;
  const nodes = [];
  for (let i = 0; i < eqvalue.length; i++) {
    const { span } = eqvalue[i];
    if (!span) {
      nodes.push(eqvalue[i]);
    } else {
      nodes.push(eqvalue.slice(i, i + span + 1));
      i += span;
    }
  }

  if (key.token === "[" || key.token === "{") {
    return (
      <span class="copyable-object [&>.key:hover+.value]:text-green-500 [&>.key:hover]:cursor-crosshair [&>.key:hover]:text-green-500">
        <span
          class="key"
          onClick={() => {
            window.navigator.clipboard.writeText(JSON.stringify(key.value));
          }}
        >
          {key.token}
        </span>
        <span class="value">
          <For each={nodes as (typeof key | (typeof key)[])[]}>
            {(node) =>
              Array.isArray(node) ? (
                <KeyValueCopierNode tokens={node} />
              ) : (
                <span
                  class="copyable-value hover:cursor-crosshair hover:text-green-500"
                  onClick={() => {
                    window.navigator.clipboard.writeText(node.token);
                  }}
                >
                  {node.token}
                </span>
              )
            }
          </For>
        </span>
      </span>
    );
  }

  const copyable = KV.isSimpleKey(key.key);

  return (
    <span
      classList={{
        "variable [&>.key:hover+.value]:text-orange-300 [&>.key:hover]:cursor-pointer [&>.key:hover]:text-orange-300":
          copyable,
      }}
    >
      <span
        class="key"
        {...(copyable && {
          role: "button",
          draggable: "true",
          "data-corvu-no-drag": true,
          onDragStart: (event) => {
            event.dataTransfer.setData(
              "text/value",
              KV.stringify({ [key.key]: key.value }),
            );

            if (props.id) {
              event.dataTransfer.setData("text/kv-id", props.id);
            }
          },
          onClick: () => {
            window.navigator.clipboard.writeText(
              KV.stringify({ [key.key]: key.value }),
            );
          },
        })}
      >
        {key.token}
      </span>
      <span class="value">
        <For each={nodes}>
          {(node) =>
            Array.isArray(node) ? (
              <KeyValueCopierNode tokens={node} />
            ) : (
              <span
                classList={{
                  "copyable-value hover:text-green-500 cursor-crosshair":
                    node.token !== "=",
                }}
                role="button"
                onClick={() => {
                  window.navigator.clipboard.writeText(node.value);
                }}
              >
                {node.token}
              </span>
            )
          }
        </For>
      </span>
    </span>
  );
}

function parseId(transfer: DataTransfer) {
  const idAndSource = transfer.getData("text/kv-id")?.split("/", 2);
  if (!idAndSource) return {};
  const [id, source] = idAndSource;
  return {
    id,
    source,
  };
}
