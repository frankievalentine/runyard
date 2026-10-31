# Security

- **Checking is read-only.** Monitoring never changes a machine or a forge, and never creates a
  token.
- **Every change is reviewed.** A review shows each step. Running it reads the machine and the
  forge again and refuses if the plan changed. Reviews work once and expire after 15 minutes.
- **Runners are handled carefully.** Runyard never replaces a runner registration, never moves
  or deletes a configured runner's folder, and never restarts or removes a busy runner. It
  retires a runner only once its replacement is online, idle, labeled and running.
- **Tokens are short-lived.** Registration and removal tokens are created at the moment of use
  and sent only over SSH's input, never as arguments or files.
- **Public repositories are refused** by default, because anyone who can open a pull request
  from a fork could run code on a persistent runner. A public repository needs an admin to type
  its name. An organization whose Default runner group admits public repositories is refused.
- **SSH is locked down:** batch mode, strict host key checking, no agent or port forwarding, and
  host keys trusted only after you compare them or the machine reports them with its setup code.
- **Credentials are encrypted** at rest with a key from the environment or a key file (see
  [Configuration](reference.md#configuration)).
- **Webhooks only prompt a check.** Signatures are verified, and a delivery only makes Runyard
  read the forge again and record the job. It never changes a machine or a forge.
- **Agents prepare, people run.** Access tokens can read and prepare changes, never run a review;
  only a dashboard session can.
