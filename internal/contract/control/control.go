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
)

// Message is one line on the control channel. The client sends hello
// once and state whenever it changes; the gateway sends sessions whenever the
// user's ready sessions change and publish when the portal changes the
// computer's published ports.
type Message struct {
	Type     string    `json:"type"`
	Hello    *Hello    `json:"hello,omitempty"`
	State    *State    `json:"state,omitempty"`
	Sessions []Session `json:"sessions,omitempty"`
	Publish  []int     `json:"publish,omitempty"`
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
}

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
