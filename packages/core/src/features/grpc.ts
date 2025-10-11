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

import grpc, {
  Metadata,
  type GrpcObject,
  type ServiceClientConstructor,
} from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  hookExecution,
  type PardonFetchExecution,
} from "../modules/playground.js";
import type {
  PardonExecutionContext,
  PardonExecutionIngress,
} from "../core/pardon/pardon.js";
import type { HttpsRequestObject } from "../core/request/https-template.js";
import { arrayIntoObjectAsync } from "../util/mapping.js";
import { PardonError } from "../core/error.js";

const protocolCache: Record<
  string,
  Promise<protoLoader.PackageDefinition>
> = {};
const protoDefinitionCache: Record<string, Promise<GrpcObject>> = {};

export default function grpcHook(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      fetch(info, next) {
        const { method } = info.egress.request;

        if (!method || method != "RPC") {
          return next(info);
        }

        const { compiler } = info.context.app();
        const protocols =
          info.match.endpoint.configuration.protocols?.map(
            (protocol) => compiler.resolveAsset(protocol).slice(-1)[0],
          ) ?? [];

        return fetchGrpc(info.egress.request, ...protocols);
      },
    },
  );
}

async function loadGrpcPackageDefinition(protocols: string[]) {
  const definitions: Promise<protoLoader.PackageDefinition>[] = [];

  for (const protocol of protocols) {
    definitions.push((protocolCache[protocol] ??= protoLoader.load(protocol)));
  }

  const combined = await arrayIntoObjectAsync(
    definitions,
    (definition) => definition,
  );

  return grpc.loadPackageDefinition(combined);
}

async function getGrpcPackageDefinition(protocols: string[]) {
  return (protoDefinitionCache[protocols.join(";")] ??=
    loadGrpcPackageDefinition(protocols));
}

function select(definition: any, ...path: string[]): ServiceClientConstructor {
  return path.reduce((x: any, part) => x[part], definition);
}

async function fetchGrpc(request: HttpsRequestObject, ...protocols: string[]) {
  const pkgdef = await getGrpcPackageDefinition(protocols);
  const [, namespace, action] = /^[/]([^/]+)[/](?<action>.*)/.exec(
    request.pathname!,
  )!;

  const { insecure } = request.meta || {};

  const origin = new URL(request.origin!);
  const credentials =
    origin.protocol == "http:"
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl(null, null, null, {
          rejectUnauthorized: insecure !== "true",
        });

  if (request.meta?.resolve) {
    throw new PardonError("grpc: DNS [resolve] meta-header not supported");
  }

  const service = select(pkgdef, ...namespace.split("."));
  const client = new service(origin.host, credentials);

  const metadata = new Metadata();
  for (const [key, value] of request.headers) {
    metadata.add(key, value);
  }

  const pendingResponse = new Promise((resolve, reject) => {
    client[action](
      JSON.parse(request.body!),
      metadata,
      (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });

  try {
    const result = await pendingResponse;

    return {
      status: 200,
      body: JSON.stringify(result),
      rawBody: Buffer.from(JSON.stringify(result)),
      headers: new Headers({
        "Content-Type": "application/grpc+json",
      }),
    } as PardonExecutionIngress;
  } catch (error) {
    return {
      status: 999,
      body: JSON.stringify(error),
      rawBody: Buffer.from(JSON.stringify(error)),
      headers: new Headers({
        "Content-Type": "application/grpc+json",
      }),
    } as PardonExecutionIngress;
  }
}
