/* a tiny no-dependency server framework:
 *
 * - regex-based router.
 * - pre-reads the body as json or text.
 * - helper for responding with json.
 * - basic 404 and 500 error handling.
 */

import { Server } from "node:http";
import { json as readJson, text as readText } from "node:stream/consumers";

async function readBody(req) {
  if (req.headers["content-type"] == "application/json") {
    return readJson(req);
  }

  return readText(req);
}


const tsf = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  second: "2-digit",
  minute: "2-digit",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZoneName: "short",
});

function formatTimestamp(date) {
  const { year, month, day, hour, minute, second, timeZoneName } =
    tsf.formatToParts(date).reduce((map, { type, value }) => Object.assign(map, {
      [type]: value,
    }), {});

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}`;
}


async function parse(req) {
  const { method } = req;
  const url = new URL(`http://server${req.url ?? "/"}`);
  const body = ["POST", "PUT"].includes(method)
    ? await readBody(req)
    : undefined;

  if (req.url != "/text") {
    console.info(`${formatTimestamp(new Date())} | ${method} ${url}`);
  }

  return {
    request: `${method} ${url.pathname}`,
    search: new URLSearchParams(url.search),
    body,
  };
}

function route(
  path,
  action
) {
  const re = new RegExp(
    `^${path
      .replaceAll(/::([a-z]*)/g, `(?<$1>.+)`)
      .replaceAll(/:([a-z]*)/g, `(?<$1>[^/]+)`)}/?$`,
  );

  return { re, action };
}

export function json(res, body) {
  res.appendHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function startServer(routemap, port = 3000) {
  new Server(async (req, res) => {
    const info = await parse(req);

    const routes = Object.entries(routemap).map(([p, a]) => route(p, a));

    try {
      for (const route of routes) {
        const match = route.re.exec(info.request);
        if (match) {
          await route.action({ ...info, slug: match.groups ?? {}, req, res });
          break;
        }
      }

      if (!res.headersSent) {
        res.statusCode = 404;
      }
      if (!res.closed) {
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      if (!res.closed) {
        res.end(String(error));
      }
    } finally {
      if (req.url !== "/text") {
        console.info(`  > ${res.statusCode}`)
      }
    }
  }).listen(port);

  console.log(`service listening on http://localhost:${port}`)
}
