/** SQL migrations are imported as text so they're embedded in the compiled binary. */
declare module "*.sql" {
  const sql: string;
  export default sql;
}

/** Machine scripts are imported as text and sent over SSH stdin. */
declare module "*.sh" {
  const script: string;
  export default script;
}

declare module "*.ps1" {
  const script: string;
  export default script;
}
