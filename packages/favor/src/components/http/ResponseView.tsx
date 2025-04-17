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

import { HTTP } from "pardon/formats";
import { createResource, ParentProps, Suspense } from "solid-js";
import settle from "../../util/settle.ts";
import LoadingSplash from "../LoadingSplash.tsx";
import CodeMirror from "../codemirror/CodeMirror.tsx";
import { ExecutionResult } from "../../signals/pardon-execution-signal.ts";
import { secureData } from "../secure-data.ts";

export default function ResponseView(
  props: ParentProps<{
    execution: Promise<ExecutionResult>;
    redacted: boolean;
    include?: boolean;
    kv?: boolean;
  }>,
) {
  const [execution] = createResource(
    () => props.execution,
    async (execution) => await settle(execution),
  );

  function displayInbound(result: ExecutionResult | ExecutionHistory) {
    const {
      context: { trace },
      inbound: { response },
    } = result;

    return HTTP.responseObject.stringify({
      ...HTTP.responseObject.fromJSON({
        ...(props.redacted
          ? response
          : (secureData()?.[trace]?.inbound.response ?? response)),
      }),
      ...(!props.include && {
        headers: new Headers(),
      }),
    });
  }

  function show(
    execution: PromiseSettledResult<ExecutionResult | ExecutionHistory>,
  ) {
    switch (true) {
      case execution?.status === "rejected":
        return String(execution?.reason ?? "").replace(
          /^Error: Error invoking remote method '\w+': Error:\s*/,
          "",
        );
      default:
        if ((execution.value as ExecutionHistory).error) {
          return (execution.value as ExecutionHistory).error;
        }

        return displayInbound(execution.value);
    }
  }

  return (
    <Suspense fallback={<LoadingSplash />}>
      <div class="flex flex-1">
        <CodeMirror
          readonly
          nowrap
          value={show(
            execution.loading
              ? { status: "rejected", reason: undefined }
              : execution(),
          )}
          class="relative flex w-0 min-w-full flex-1 overflow-auto [&_.cm-content]:pb-5 [&_.cm-line]:pr-2"
          text="10pt"
          overlay={props.children}
        />
      </div>
    </Suspense>
  );
}
