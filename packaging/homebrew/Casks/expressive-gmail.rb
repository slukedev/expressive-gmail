cask "expressive-gmail" do
  version "0.1.2"
  sha256 "86d91646fe3e4ac8482257ca4ed527d525dd3eccbf2abc6a1a1fe303b5edc52e"

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
