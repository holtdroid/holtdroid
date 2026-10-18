// Package control holds the types connect clients share with the api and
// the ssh-gateway. It has no dependencies, so the client stays small.
package control

import "time"

// Subsystem is the SSH subsystem a connect client opens to exchange
// Messages, one JSON object per line, with the gateway.
const Subsystem = "holtdroid-control@holtdroid"

const (
	TypeHello    = "hello"
	TypeState    = "state"
	TypeSessions = "sessions"
	TypePublish  = "publish"
	TypeGateway  = "gateway"
)

// Message is one line on the control channel. The client sends hello
// once and state whenever it changes; the gateway sends gateway first, then
// sessions whenever the user's ready sessions change and publish when the
// portal changes the computer's published ports.
type Message struct {
	Type     string    `json:"type"`
	Hello    *Hello    `json:"hello,omitempty"`
	Gateway  *Gateway  `json:"gateway,omitempty"`
	State    *State    `json:"state,omitempty"`
	Sessions []Session `json:"sessions,omitempty"`
	Publish  []int     `json:"publish,omitempty"`
}

// Gateway is what the gateway allows, so the client doesn't offer the rest.
type Gateway struct {
	ADB     bool `json:"adb" doc:"devices' ADB can be reached"`
	Publish bool `json:"publish" doc:"ports can be published on devices"`
}

type Hello struct {
	Version string `json:"version"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
}

type State struct {
	Listening []LocalPort `json:"listening"`
	Published []int       `json:"published"`
	ADB       []ADBPort   `json:"adb"`
	Mode      PublishMode `json:"mode,omitempty"`
	Pinned    []int       `json:"pinned"`
}

// PublishMode is how a client picks the ports it publishes: only the ones
// the user picked, also every dev server, or every listener.
type PublishMode string

const (
	PublishManual PublishMode = "manual"
	PublishDev    PublishMode = "dev"
	PublishAll    PublishMode = "all"
)

type Session struct {
	Slug        string `json:"slug" doc:"{provider}-{id}, also the host name a client dials for the session's ADB"`
	Provider    string `json:"provider"`
	ID          string `json:"id"`
	Package     string `json:"package,omitempty"`
	Label       string `json:"label,omitempty"`
	VersionName string `json:"versionName,omitempty"`
}

// Enroll trades a one-time code from the portal for credentials.
type Enroll struct {
	Code      string `json:"code" minLength:"1" maxLength:"4096"`
	PublicKey string `json:"publicKey" minLength:"1" maxLength:"8192" doc:"the computer's OpenSSH public key"`
	Hostname  string `json:"hostname" maxLength:"253"`
	OS        string `json:"os" maxLength:"32"`
	Arch      string `json:"arch" maxLength:"32"`
}

type Refresh struct {
	RefreshToken string `json:"refreshToken" minLength:"1" maxLength:"8192"`
	PublicKey    string `json:"publicKey" minLength:"1" maxLength:"8192" doc:"the key the refresh token was issued for"`
}

// Credentials let a connect client log in to the gateway until
// CertificateExpiresAt and get new ones with RefreshToken.
type Credentials struct {
	User                 string    `json:"user"`
	Computer             string    `json:"computer"`
	Handle               string    `json:"handle" doc:"SSH user name"`
	Host                 string    `json:"host"`
	Port                 int       `json:"port"`
	HostKeys             []string  `json:"hostKeys" doc:"authorized_keys lines the gateway may present"`
	Certificate          string    `json:"certificate" doc:"OpenSSH user certificate for the computer's key"`
	CertificateExpiresAt time.Time `json:"certificateExpiresAt"`
	RefreshToken         string    `json:"refreshToken" doc:"replaces the previous one"`
	RefreshExpiresAt     time.Time `json:"refreshExpiresAt"`
	AccessToken          string    `json:"accessToken" doc:"Authorization: Bearer token for the portal's API and session proxy, valid as long as the certificate"`
}

// Extensions the api writes into a connect client's certificate for the
// gateway: who the computer belongs to and what it is called.
const (
	CertUser     = "user@holtdroid"
	CertAdmin    = "admin@holtdroid"
	CertHostname = "hostname@holtdroid"
)

// Computer is a connect client attached to one gateway replica.
type Computer struct {
	ID        string      `json:"id" doc:"stays the same across reconnects of one enrolled computer"`
	Hostname  string      `json:"hostname"`
	OS        string      `json:"os"`
	Arch      string      `json:"arch"`
	Version   string      `json:"version"`
	ClientIP  string      `json:"clientIP"`
	Since     time.Time   `json:"since"`
	Listening []LocalPort `json:"listening" doc:"TCP ports listening on the computer's loopback"`
	Published []int       `json:"published" doc:"ports published on every ready session of the user"`
	ADB       []ADBPort   `json:"adb" doc:"local ports the computer forwards to each session's ADB"`
	Mode      PublishMode `json:"mode" enum:"manual,dev,all" doc:"manual publishes only pinned ports; dev also every dev server, all every listener"`
	Pinned    []int       `json:"pinned" doc:"ports the user picked; publishing a set of ports replaces these"`
}

type LocalPort struct {
	Port    int    `json:"port"`
	Process string `json:"process,omitempty"`
}

type ADBPort struct {
	Session string `json:"session" doc:"{provider}-{id}"`
	Port    int    `json:"port"`
}

// Manifest lists the client builds a portal serves at
// /connect/holtdroid-{platform}, so a client can tell it is outdated.
type Manifest struct {
	Clients []Build `json:"clients"`
}

type Build struct {
	Platform string `json:"platform" doc:"{os}-{arch}"`
	SHA256   string `json:"sha256"`
}
