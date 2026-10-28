/** A throwaway public key and the fingerprint `ssh-keygen -lf` printed for it. */
export const FIXTURE_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEhWT6AYd6Wo9Z9uMu9PpNogMM0rdjDjyJ0bWkoJkn2W fixture";
export const FIXTURE_FINGERPRINT = "SHA256:MC5Cv4ua4choeyIFpdOxd6UvV7OeqfMAtj+u8OU6n58";

/** A second throwaway key, for a machine whose host key changed. */
export const OTHER_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG/FeyuFdn87onRcLm14XJUNN6NZuZkkW+AS8dFeZmq/ fixture2";
export const OTHER_FINGERPRINT = "SHA256:9+Ph9RBz3TEroKE63fXI6Z9Q3du9sVwlCbiuJvDE7Uk";
