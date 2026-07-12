# Homebrew formula for slika.
#
# This file is the template committed to the main repo. Each release's
# `release.yml` workflow produces a fully-populated `slika.rb` (with real
# sha256 sums, wired to that release's binaries) in `dist/` and attaches it to
# the GitHub release. Copy that generated file into your Homebrew tap
# (e.g. paperfoot/homebrew-tap) to publish.
#
# Users install with:
#   brew install paperfoot/tap/slika
#
# Or, for a one-off install without a tap:
#   brew install --cask <url-to-a-generated-slika.rb>
#
# The SHA256 placeholders below are intentionally left as-is so a wrong paste
# fails loudly (brew refuses formulae whose sha256 doesn't match).

class Slika < Formula
  desc "Image generation from the terminal (GPT Image 2, Nano Banana, GPT-5 Image)"
  homepage "https://github.com/paperfoot/slika"
  version "5.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/paperfoot/slika/releases/download/v5.0.0/slika-darwin-arm64"
      sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
    else
      url "https://github.com/paperfoot/slika/releases/download/v5.0.0/slika-darwin-x64"
      sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/paperfoot/slika/releases/download/v5.0.0/slika-linux-arm64"
      sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
    else
      url "https://github.com/paperfoot/slika/releases/download/v5.0.0/slika-linux-x64"
      sha256 "REPLACE_WITH_SHA256_FROM_RELEASE"
    end
  end

  def install
    bin_name = OS.mac? ? (Hardware::CPU.arm? ? "slika-darwin-arm64" : "slika-darwin-x64")
                       : (Hardware::CPU.arm? ? "slika-linux-arm64"  : "slika-linux-x64")
    bin.install bin_name => "slika"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/slika --version")
  end
end
