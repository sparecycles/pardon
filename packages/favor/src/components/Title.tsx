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

import { ComponentProps, splitProps } from "solid-js";
import { twMerge } from "tailwind-merge";

export default function Title(props: ComponentProps<"div">) {
  const [, divProps] = splitProps(props, ["children"]);
  return (
    <div
      {...divProps}
      class={twMerge(divProps.class, "zen mb-1 [&:not(:first-child)]:mt-3")}
    >
      <span class="title flex flex-1 border-t-[0.125rem] px-1 dark:border-slate-400 dark:bg-slate-600">
        {props.children}
      </span>
    </div>
  );
}
