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
    <div {...divProps} class={twMerge(divProps.class, "zen px-2 pb-2")}>
      <span class="title flex flex-1 place-content-start border-b-1 border-current border-opacity-25">
        {props.children}
      </span>
    </div>
  );
}
