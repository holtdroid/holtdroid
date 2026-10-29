import chromium from "../../assets/repos/chromium-builds.svg"
import redroid from "../../assets/repos/holtdroid-redroid.svg"
import sync from "../../assets/repos/holtdroid-sync.svg"
import tunnel from "../../assets/repos/holtdroid-tunnel.svg"
import webview from "../../assets/repos/holtdroid-webview.svg"
import holtdroid from "../../assets/repos/holtdroid.svg"

export type Repo = {
  name: string
  role: string
  icon: ImageMetadata
  description: string
  docs: string
  tags: string[]
}

const docs = "/holtdroid"

export const repos: Repo[] = [
  {
    name: "holtdroid",
    role: "The portal",
    icon: holtdroid,
    description:
      "The api and web UI, the device providers, the agent that runs next to every device, the SSH gateway, the holtdroid client for your computer and the Helm chart.",
    docs: `${docs}/start/introduction/`,
    tags: ["Go", "React", "Helm"],
  },
  {
    name: "holtdroid-redroid",
    role: "Android images",
    icon: redroid,
    description:
      "redroid, Android in a container, prepared for sessions: one image per Android version, with ARM64 translation for ARM-only builds.",
    docs: `${docs}/configuration/emulator/`,
    tags: ["Container image", "Android"],
  },
  {
    name: "holtdroid-sync",
    role: "Where builds come from",
    icon: sync,
    description:
      "Jobs that copy APKs from Slack channels, S3 buckets and GitHub releases into Holtdroid's sources, with icons and changelogs.",
    docs: `${docs}/sources/overview/`,
    tags: ["Go", "Slack", "S3", "GitHub"],
  },
  {
    name: "holtdroid-tunnel",
    role: "Network for real phones",
    icon: tunnel,
    description:
      "A VpnService that sends all of a phone's traffic over USB to the host, so a USB phone gets the session's country without root or Wi-Fi.",
    docs: `${docs}/configuration/phones/`,
    tags: ["Kotlin", "Android app"],
  },
  {
    name: "holtdroid-webview",
    role: "Test browser",
    icon: webview,
    description:
      "An Android WebView playground with DevTools unlocked, presets of WebView settings and adb control. Works without Holtdroid too.",
    docs: `${docs}/tools/webview/`,
    tags: ["Kotlin", "Android app"],
  },
  {
    name: "chromium-builds",
    role: "Browser versions on demand",
    icon: chromium,
    description:
      "Chromium and WebView for Android built from release tags with proprietary codecs, to reproduce a bug on the exact version it was reported on.",
    docs: `${docs}/sources/chromium/`,
    tags: ["APK", "x86_64", "arm64"],
  },
]

export const byName = (name: string) => repos.find((r) => r.name === name)!
