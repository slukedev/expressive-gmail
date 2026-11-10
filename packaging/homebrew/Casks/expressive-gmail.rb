cask "expressive-gmail" do
  version "0.2.0"
  sha256 "b6385f88ec66c44e818ae300617557010209dbc74321b53e79deaf83e74bf724"

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
