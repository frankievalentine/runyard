# From aarondfrancis/fleet (crates/fleet/scripts/nixos-runner-prerequisites.nix); only these
# comments changed. Import it from /etc/nixos/configuration.nix and rebuild before Runyard
# installs runners on the machine. Runner names, paths, labels and registration stay with Runyard.
{ pkgs, ... }: {
  programs.nix-ld.enable = true;
  programs.nix-ld.libraries = with pkgs; [
    stdenv.cc.cc zlib openssl icu krb5 lttng-ust curl libunwind
  ];
  # The upstream runner's service and auto-update scripts use /bin/bash.
  systemd.tmpfiles.rules = [
    "L /bin/bash - - - - /run/current-system/sw/bin/bash"
  ];
  environment.systemPackages = with pkgs; [
    bash coreutils curl gnutar gzip git glibc.bin
  ];
}
