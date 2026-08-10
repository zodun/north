// Apple + Google buttons (DEC-18) for the (auth) flow. Same OAuth
// flow as the legacy components/social-sign-in.tsx, but rendered
// through @north/native-ui Button with its built-in `loading` state.
//
// Google: expo-auth-session's Google provider opens the OAuth flow,
// returns an ID token, and we hand it to Supabase via
// signInWithIdToken — that bypasses the redirect dance Supabase's
// signInWithOAuth would require on native.
//
// Apple: expo-apple-authentication on iOS only. Returns an identity
// token straight to us; same Supabase handoff. Android is skipped.

import { env } from "@north/env/native";
import { Button } from "@north/native-ui";
import { getNorthTokens } from "@north/tokens";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { supabase } from "@/lib/auth-client";

WebBrowser.maybeCompleteAuthSession();

export type SocialButtonsProps = {
	onError: (msg: string) => void;
};

export function SocialButtons({ onError }: SocialButtonsProps) {
	const { p, t, d } = getNorthTokens();

	const [appleAvailable, setAppleAvailable] = useState(false);
	const [googlePending, setGooglePending] = useState(false);
	const [applePending, setApplePending] = useState(false);

	useEffect(() => {
		if (Platform.OS !== "ios") return;
		AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
	}, []);

	const [, response, promptGoogle] = Google.useAuthRequest({
		// The hook throws if the current platform's *ClientId is undefined,
		// which crashes the whole (auth) screen whenever Google OAuth isn't
		// configured for that platform. The placeholder never reaches Google:
		// googleConfigured hides the button (and onGoogle guards) whenever the
		// real id is unset.
		iosClientId:
			env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID ??
			(Platform.OS === "ios"
				? "unconfigured.apps.googleusercontent.com"
				: undefined),
		androidClientId:
			env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID ??
			(Platform.OS === "android"
				? "unconfigured.apps.googleusercontent.com"
				: undefined),
		webClientId:
			env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID ??
			(Platform.OS === "web"
				? "unconfigured.apps.googleusercontent.com"
				: undefined),
	});

	useEffect(() => {
		if (!response) return;
		if (response.type === "success") {
			const idToken = response.params.id_token;
			if (!idToken) {
				setGooglePending(false);
				return;
			}
			(async () => {
				const { error } = await supabase.auth.signInWithIdToken({
					provider: "google",
					token: idToken,
				});
				if (error) onError(error.message);
				setGooglePending(false);
			})();
		} else {
			// user dismissed or error — clear pending, no banner
			setGooglePending(false);
		}
	}, [response, onError]);

	const onGoogle = async () => {
		if (!env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID) {
			onError("Google sign-in not configured");
			return;
		}
		setGooglePending(true);
		await promptGoogle();
	};

	const onApple = async () => {
		setApplePending(true);
		try {
			const rawNonce = Crypto.randomUUID();
			const hashedNonce = await Crypto.digestStringAsync(
				Crypto.CryptoDigestAlgorithm.SHA256,
				rawNonce,
			);
			const credential = await AppleAuthentication.signInAsync({
				requestedScopes: [
					AppleAuthentication.AppleAuthenticationScope.EMAIL,
					AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
				],
				nonce: hashedNonce,
			});
			if (!credential.identityToken) {
				onError("Apple sign-in returned no identity token");
				return;
			}
			const { error } = await supabase.auth.signInWithIdToken({
				provider: "apple",
				token: credential.identityToken,
				nonce: rawNonce,
			});
			if (error) onError(error.message);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!message.includes("ERR_REQUEST_CANCELED")) onError(message);
		} finally {
			setApplePending(false);
		}
	};

	const googleConfigured = Boolean(env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID);
	if (!googleConfigured && !appleAvailable) return null;

	return (
		<View style={[styles.wrap, { gap: d.gap }]}>
			{appleAvailable ? (
				// Outline, not gold — the screen's one needle is its main CTA.
				<Button
					p={p}
					t={t}
					variant="outline"
					loading={applePending}
					onPress={onApple}
				>
					Continue with Apple
				</Button>
			) : null}
			{googleConfigured ? (
				<Button
					p={p}
					t={t}
					variant="outline"
					loading={googlePending}
					onPress={onGoogle}
				>
					Continue with Google
				</Button>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {},
});
