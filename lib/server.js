import { json, startServer } from "../lib/mini-router.js";

let nextId = 1001;

const todos = [{
  id: `T${nextId++}`,
  task: 'get setup with pardon',
  completed: false,
}];

function list() {
  return todos.map(({ task, completed }) =>
    `- [${completed ? 'x' : ' '}]: ${task}`
  ).join('\n').trim()
}

startServer({
  "GET /"({ res }) {
    res.end(`
      <pre style="padding: 10px">${list()}</pre>
      <script language="javascript">
      ${(() => {
        setInterval(
          async () => document.querySelector('pre').textContent = await (await fetch('/text')).text(),
          300
        )
      }).toString().replace(/[(][)]\s*=>\s*/, '')}
      </script>
    `.trim())
  },
  "GET /text"({ res }) {
    res.end(list());
  },
  "GET /ping"({ res }) {
    res.end("pong");
  },
  "GET /todos"({ res }) {
    json(res, todos);
  },
  "GET /todos/:id"({ res, slug: { id } }) {
    const todo = todos.find(todo => todo.id === id);
    if (todo) {
      json(res, todo);
    }
  },
  "PUT /todos/:id"({ res, body, slug: { id } }) {
    const todo = todos.find(todo => todo.id === id);
    if (todo) {
      const { completed, task } = body;
      Object.assign(todo, {
        ...(typeof completed === 'boolean' && { completed }),
        ...(typeof task === 'string' && { task })
      });

      json(res, { id, ...todo });
    }
  },
  "DELETE /todos/:id"({ res, slug: { id } }) {
    const index = todos.findIndex(todo => todo.id === id);
    if (index >= 0) {
      todos.splice(index, 1);
      res.statusCode = 204;
      res.end();
    }
  },
  "POST /todos"({ res, body }) {
    const id = `T${nextId++}`;
    todos.push({ id, completed: false, ...body });

    json(res, todos.slice(-1)[0]);
  }
}, process.env.PORT ?? 3000);
