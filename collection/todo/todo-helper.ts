import { pardon } from "pardon";

export async function getCompleted({
  todo,
  origin,
}: {
  todo: string;
  origin: string;
}) {
  const {
    inbound: {
      values: { completed },
    },
  } = await pardon({
    todo,
    origin,
  })`GET https://todo.example.com/todos/{{todo}}`();

  return completed;
}
