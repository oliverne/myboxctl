#!/bin/sh
set -eu

repository="oliverne/myboxctl"
version="${MYBOXCTL_VERSION:-__MYBOXCTL_VERSION__}"
install_dir="${MYBOXCTL_INSTALL_DIR:-}"

case "$(uname -s)" in
  Linux) platform="linux" ;;
  *)
    echo "myboxctl install.sh supports Linux only; use Homebrew on macOS." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [ -z "$install_dir" ]; then
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    install_dir="/usr/local/bin"
  else
    install_dir="$HOME/.local/bin"
  fi
fi

asset="myboxctl-v$version-$platform-$arch.tar.gz"
base_url="https://github.com/$repository/releases/download/v$version"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

curl -fsSL "$base_url/$asset" -o "$temporary_dir/$asset"
curl -fsSL "$base_url/SHA256SUMS" -o "$temporary_dir/SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$temporary_dir/SHA256SUMS")"
if [ -z "$expected" ]; then
  echo "Checksum for $asset was not found." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary_dir/$asset" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$temporary_dir/$asset" | awk '{ print $1 }')"
else
  echo "sha256sum or shasum is required." >&2
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  echo "Checksum verification failed for $asset." >&2
  exit 1
fi

tar -xzf "$temporary_dir/$asset" -C "$temporary_dir" myboxctl
mkdir -p "$install_dir"
install -m 0755 "$temporary_dir/myboxctl" "$install_dir/myboxctl"
"$install_dir/myboxctl" --version
echo "Installed myboxctl to $install_dir/myboxctl"
