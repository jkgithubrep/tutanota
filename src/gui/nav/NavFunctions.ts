import { FeatureType } from "../../api/common/TutanotaConstants"
import { locator } from "../../api/main/MainLocator.js"

export function showUpgradeDialog() {
	import("../../subscription/UpgradeSubscriptionWizard.js").then((upgradeWizard) => upgradeWizard.showUpgradeWizard())
}

export function showSupportDialog() {
	import("../../support/SupportDialog.js").then((supportModule) => supportModule.showSupportDialog())
}

export function writeInviteMail() {
	import("../../mail/editor/MailEditor.js").then((mailEditorModule) => mailEditorModule.writeInviteMail())
}

export function isNewMailActionAvailable(): boolean {
	return locator.logins.isInternalUserLoggedIn() && !locator.logins.isEnabled(FeatureType.ReplyOnly)
}
