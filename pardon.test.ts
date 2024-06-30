import assert from 'assert';
import { cases, execute } from 'pardon/testing';
import { type PardonTestConfiguration } from "pardon/testing";

export default {
} as PardonTestConfiguration;

cases(({set, each, counter }) => {
  set("task", each(
    "setup pardon",
    "read docs",
    "run tests",
    "create a collection",
    "teach others"
  ));

  counter("counter");
}).trial('create-task-%counter', async () => {
  await new Promise((resolve) => setTimeout(resolve, 500*environment.counter));

  await execute("create-todo.flow");

  await execute("get-todo.flow");
  assert.equal(environment.completed, false, "not done yet");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await execute("update-todo.flow", { completed: true });

  console.log({ ...environment })

  await execute("get-todo.flow");
  assert.equal(environment.completed, true, "should be completed now");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await execute("delete-todo.flow");
});
