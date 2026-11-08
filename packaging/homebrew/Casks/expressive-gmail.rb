cask "expressive-gmail" do
  version "0.1.0"
  sha256 "6a1224c404c4ca2ae914468621998d4bb02cb4ef78c1d939941ddff97f1deecc"

  url "https://github.com/slukedev/expressive-gmail/releases/download/v#{version}/Expressive-Gmail-#{version}.zip"
  name "Expressive Gmail"
  desc "Gmail rebuilt in Material 3 Expressive, for Safari"
  homepage "https://github.com/slukedev/expressive-gmail"

  depends_on macos: :monterey

  app "Expressive Gmail.app"

  zap trash: [
    "~/Library/Containers/dev.luke.bettergmail",
    "~/Library/Containers/dev.luke.bettergmail.Extension",
    "~/Library/Preferences/dev.luke.bettergmail.plist",
    "~/Library/Saved Application State/dev.luke.bettergmail.savedState",
  ]

  caveats <<~EOS
    Open Expressive Gmail, click Safari Settings and turn the extension on.
  EOS
end
