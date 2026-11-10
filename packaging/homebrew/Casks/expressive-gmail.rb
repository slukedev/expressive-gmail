cask "expressive-gmail" do
  version "0.1.5"
  sha256 "8d186790dedd8fdabace00f6b2eb2e8c363c565c7b5a33b7243709a4aac9bcee"

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
