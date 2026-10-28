/** SQL migrations are imported as text so they're embedded in the compiled binary. */
declare module "*.sql" {
  const sql: string;
  export default sql;
}
