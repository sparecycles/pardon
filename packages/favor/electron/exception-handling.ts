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
import { hookExecution, PardonFetchExecution } from "pardon/runtime";

class StepError extends Error {
  constructor(step: string, cause?: Error) {
    super(step, { cause });
  }
}

export default function exceptionHandling(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution(execution, {
    async init(data, next) {
      try {
        return await next(data);
      } catch (error) {
        throw new StepError("init", error);
      }
    },
    async match(data, next) {
      try {
        return await next(data);
      } catch (error) {
        throw new StepError("match", error);
      }
    },
    async render(data, next) {
      try {
        return await next(data);
      } catch (error) {
        throw new StepError("render", error);
      }
    },
    async fetch(data, next) {
      try {
        return await next(data);
      } catch (error) {
        throw new StepError("fetch", error);
      }
    },
    async process(data, next) {
      try {
        return await next(data);
      } catch (error) {
        throw new StepError("process", error);
      }
    },
  });
}
