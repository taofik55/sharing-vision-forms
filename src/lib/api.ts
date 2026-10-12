/** Uniform JSON response for endpoints that are stubbed until a later phase. */
export function notImplemented() {
  return Response.json({ error: "not_implemented" }, { status: 501 });
}
