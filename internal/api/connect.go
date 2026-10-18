package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/danielgtaylor/huma/v2"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/ssh"

	"github.com/kriakiku/holtdroid/internal/audit"
	"github.com/kriakiku/holtdroid/internal/auth"
	"github.com/kriakiku/holtdroid/internal/contract"
	"github.com/kriakiku/holtdroid/internal/contract/control"
	"github.com/kriakiku/holtdroid/internal/sshkey"
)

const (
	audienceCode    = "connect-code"
	audienceRefresh = "connect-refresh"
)

// connectCA signs connect clients' keys into short-lived SSH certificates
// and issues the stateless tokens that lead to them.
type connectCA struct {
	signer   ssh.Signer
	tokenKey []byte

	mu   sync.Mutex
	used map[string]time.Time
}

func newConnectCA(ctx context.Context, s *Server) (*connectCA, error) {
	signer, secret, temporary, err := sshkey.LoadPrivate(ctx, s.secrets, s.cfg.SSH.CAKey)
	if err != nil {
		return nil, fmt.Errorf("ssh.caKey: %w", err)
	}
	if temporary {
		s.log.Warn("ssh.caKey is not set: using a temporary key, enrolled computers must enroll again after a restart")
	}
	sum := sha256.Sum256(append([]byte("holtdroid connect tokens\x00"), secret...))
	return &connectCA{signer: signer, tokenKey: sum[:], used: map[string]time.Time{}}, nil
}

type connectClaims struct {
	jwt.RegisteredClaims
	Groups   []string `json:"groups,omitempty"`
	Admin    bool     `json:"admin,omitempty"`
	Computer string   `json:"cid,omitempty"`
	Hostname string   `json:"hostname,omitempty"`
	Key      string   `json:"key,omitempty"`
	Gen      int      `json:"gen,omitempty"`
}

func (ca *connectCA) sign(claims connectClaims) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(ca.tokenKey)
}

func (ca *connectCA) parse(token, audience string, now time.Time) (connectClaims, error) {
	var claims connectClaims
	_, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return ca.tokenKey, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer("holtdroid"),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if err != nil || claims.Subject == "" {
		return connectClaims{}, errors.New("invalid or expired")
	}
	return claims, nil
}

// use marks a code as spent on this replica. Codes are signed, not stored,
// so another replica could still take the same code until it expires.
func (ca *connectCA) use(id string, expires, now time.Time) bool {
	ca.mu.Lock()
	defer ca.mu.Unlock()
	for k, exp := range ca.used {
		if now.After(exp) {
			delete(ca.used, k)
		}
	}
	if _, spent := ca.used[id]; spent {
		return false
	}
	ca.used[id] = expires
	return true
}

func randomID() string {
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	return strings.ToLower(base32.StdEncoding.EncodeToString(b))
}

type ConnectCode struct {
	Code      string    `json:"code" doc:"one-time enrollment code for the connect client"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type ComputerList struct {
	Computers []control.Computer `json:"computers" doc:"the caller's computers connected to any gateway replica right now"`
}

type publishedInput struct {
	ID   string `path:"id" minLength:"1" maxLength:"64"`
	Body struct {
		Ports []int `json:"ports" maxItems:"256"`
	}
}

func (s *Server) registerConnect(api huma.API) {
	tags := []string{"ssh"}
	disabled := func() error { return huma.Error404NotFound("SSH access is not enabled") }

	huma.Register(api, huma.Operation{
		OperationID: "createConnectCode", Method: http.MethodPost, Path: "/api/v1/connect/codes", Tags: tags,
		Description: "A one-time code that enrolls a computer's connect client for the caller.",
	}, func(ctx context.Context, _ *struct{}) (*out[ConnectCode], error) {
		if s.ca == nil {
			return nil, disabled()
		}
		who, _ := auth.FromContext(ctx)
		now := s.now()
		expires := now.Add(s.cfg.SSH.CodeTTL)
		code, err := s.ca.sign(connectClaims{
			Issuer: "holtdroid", Subject: who.User, Audience: jwt.ClaimStrings{audienceCode}, ID: randomID(),
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expires),
			Groups: who.Groups, Admin: who.Admin,
		})
		if err != nil {
			return nil, err
		}
		return &out[ConnectCode]{ConnectCode{Code: code, ExpiresAt: expires.UTC()}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "enrollComputer", Method: http.MethodPost, Path: "/api/v1/connect/enroll", Tags: tags,
		Description: "Called by the connect client: trades a one-time code and the computer's public key for credentials.",
	}, func(ctx context.Context, in *struct{ Body control.Enroll }) (*out[control.Credentials], error) {
		if s.ca == nil {
			return nil, disabled()
		}
		now := s.now()
		claims, err := s.ca.parse(in.Body.Code, audienceCode, now)
		if err != nil {
			s.emit(ctx, audit.Event{Action: audit.SSHEnroll, Result: audit.Denied, Reason: "code " + err.Error()})
			return nil, huma.Error401Unauthorized("the code is invalid or expired; copy a new command from the portal")
		}
		key, err := sshkey.Parse(in.Body.PublicKey)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		if !s.ca.use(claims.ID, claims.ExpiresAt.Time, now) {
			s.emit(ctx, audit.Event{Action: audit.SSHEnroll, Actor: claims.Subject, Result: audit.Denied, Reason: "code already used"})
			return nil, huma.Error401Unauthorized("the code was already used; copy a new command from the portal")
		}
		claims.Computer = randomID()
		claims.Hostname = cleanHostname(in.Body.Hostname)
		claims.Key = key.Fingerprint
		creds, err := s.issueCredentials(ctx, claims, key, now)
		s.emitResult(ctx, audit.Event{
			Action: audit.SSHEnroll, Actor: claims.Subject, Admin: claims.Admin,
			Details: map[string]string{"computer": claims.Computer, "hostname": claims.Hostname, "fingerprint": key.Fingerprint, "os": in.Body.OS + "/" + in.Body.Arch},
		}, err)
		if err != nil {
			return nil, err
		}
		return &out[control.Credentials]{creds}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "refreshComputer", Method: http.MethodPost, Path: "/api/v1/connect/refresh", Tags: tags,
		Description: "Called by the connect client: a new certificate and refresh token for the key a refresh token was issued for.",
	}, func(ctx context.Context, in *struct{ Body control.Refresh }) (*out[control.Credentials], error) {
		if s.ca == nil {
			return nil, disabled()
		}
		now := s.now()
		claims, err := s.ca.parse(in.Body.RefreshToken, audienceRefresh, now)
		if err != nil {
			return nil, huma.Error401Unauthorized("this computer's enrollment is invalid or expired; copy a new command from the portal")
		}
		key, err := sshkey.Parse(in.Body.PublicKey)
		if err != nil || key.Fingerprint != claims.Key {
			return nil, huma.Error401Unauthorized("the key doesn't match this computer's enrollment")
		}
		claims.Gen++
		creds, err := s.issueCredentials(ctx, claims, key, now)
		if err != nil {
			return nil, err
		}
		return &out[control.Credentials]{creds}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "listComputers", Method: http.MethodGet, Path: "/api/v1/ssh/computers", Tags: tags,
		Description: "The caller's computers whose connect client is attached right now.",
	}, func(ctx context.Context, _ *struct{}) (*out[ComputerList], error) {
		list := ComputerList{Computers: []control.Computer{}}
		if s.ca == nil {
			return &out[ComputerList]{list}, nil
		}
		who, _ := auth.FromContext(ctx)
		found, err := s.computers(ctx, who.User)
		if err != nil {
			return nil, huma.Error502BadGateway(err.Error())
		}
		list.Computers = append(list.Computers, found...)
		return &out[ComputerList]{list}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "setComputerPublished", Method: http.MethodPut, Path: "/api/v1/ssh/computers/{id}/published", Tags: tags,
		Description: "Replace the ports one of the caller's computers publishes on their sessions.", DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *publishedInput) (*struct{}, error) {
		if s.ca == nil {
			return nil, disabled()
		}
		for i, p := range in.Body.Ports {
			if p < 1 || p > 65535 {
				return nil, huma.Error422UnprocessableEntity("invalid port", &huma.ErrorDetail{Message: "must be a TCP port", Location: fmt.Sprintf("body.ports[%d]", i)})
			}
		}
		who, _ := auth.FromContext(ctx)
		err := s.setPublished(ctx, who.User, in.ID, in.Body.Ports)
		switch {
		case errors.Is(err, contract.ErrNotFound):
			return nil, huma.Error404NotFound("this computer is not connected")
		case err != nil:
			return nil, huma.Error502BadGateway(err.Error())
		}
		return nil, nil
	})
}

func (s *Server) issueCredentials(ctx context.Context, claims connectClaims, key sshkey.Key, now time.Time) (control.Credentials, error) {
	hostKeys, err := s.gatewayHostKeys(ctx)
	if err != nil {
		return control.Credentials{}, huma.Error502BadGateway(err.Error())
	}
	handle := s.sshHandle(claims.Subject)
	certExpires := now.Add(s.cfg.SSH.CertificateTTL)
	ext := map[string]string{"permit-port-forwarding": "", control.CertUser: claims.Subject, control.CertHostname: claims.Hostname}
	if claims.Admin {
		ext[control.CertAdmin] = "true"
	}
	var serial [8]byte
	_, _ = rand.Read(serial[:])
	cert := &ssh.Certificate{
		Key:             key.Public,
		Serial:          binary.BigEndian.Uint64(serial[:]),
		CertType:        ssh.UserCert,
		KeyId:           claims.Computer,
		ValidPrincipals: []string{handle},
		ValidAfter:      uint64(now.Add(-time.Minute).Unix()),
		ValidBefore:     uint64(certExpires.Unix()),
		Extensions:      ext,
	}
	if err := cert.SignCert(rand.Reader, s.ca.signer); err != nil {
		return control.Credentials{}, err
	}

	refreshExpires := now.Add(s.cfg.SSH.RefreshTTL)
	claims.RegisteredClaims = jwt.RegisteredClaims{
		Issuer: "holtdroid", Subject: claims.Subject, Audience: jwt.ClaimStrings{audienceRefresh}, ID: randomID(),
		IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(refreshExpires),
	}
	refresh, err := s.ca.sign(claims)
	if err != nil {
		return control.Credentials{}, err
	}
	info := s.sshInfo()
	return control.Credentials{
		User: claims.Subject, Computer: claims.Computer, Handle: handle, Host: info.Host, Port: info.Port, HostKeys: hostKeys,
		Certificate: string(ssh.MarshalAuthorizedKey(cert)), CertificateExpiresAt: certExpires.UTC(),
		RefreshToken: refresh, RefreshExpiresAt: refreshExpires.UTC(),
	}, nil
}

func cleanHostname(name string) string {
	name = strings.Map(func(r rune) rune {
		if unicode.IsPrint(r) && !unicode.IsSpace(r) {
			return r
		}
		return -1
	}, name)
	if len(name) > 64 {
		name = name[:64]
	}
	if name == "" {
		return "computer"
	}
	return name
}

// SSHAuthority is the CA public key gateways trust for connect clients.
func (s *Server) SSHAuthority(context.Context) (string, error) {
	if s.ca == nil {
		return "", fmt.Errorf("%w: SSH access is not enabled", contract.ErrNotFound)
	}
	return sshkey.Authorized(s.ca.signer.PublicKey()), nil
}

// gatewayHostKeys asks replicas until one answers; they share the host key.
func (s *Server) gatewayHostKeys(ctx context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	urls, err := s.gatewayReplicas(ctx)
	if err != nil {
		return nil, err
	}
	var errs []error
	for _, u := range urls {
		keys, err := contract.NewSSHGatewayClient(u, s.sshHTTP).HostKeys(ctx)
		if err == nil {
			return keys, nil
		}
		errs = append(errs, err)
	}
	return nil, fmt.Errorf("no ssh-gateway replica named its host key: %w", errors.Join(errs...))
}

// computers asks every replica, since each knows only the clients attached
// to it.
func (s *Server) computers(ctx context.Context, user string) ([]control.Computer, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	urls, err := s.gatewayReplicas(ctx)
	if err != nil {
		return nil, err
	}
	found := make([][]control.Computer, len(urls))
	errs := make([]error, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Go(func() {
			found[i], errs[i] = contract.NewSSHGatewayClient(u, s.sshHTTP).Computers(ctx, user)
		})
	}
	wg.Wait()
	var all []control.Computer
	var failed []error
	for i, err := range errs {
		if err != nil {
			s.log.Warn("ssh-gateway replica computers", "replica", urls[i], "err", err)
			failed = append(failed, err)
			continue
		}
		all = append(all, found[i]...)
	}
	if len(failed) == len(urls) {
		return nil, fmt.Errorf("no ssh-gateway replica answered: %w", errors.Join(failed...))
	}
	return all, nil
}

func (s *Server) setPublished(ctx context.Context, user, computer string, ports []int) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	urls, err := s.gatewayReplicas(ctx)
	if err != nil {
		return err
	}
	errs := make([]error, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Go(func() {
			errs[i] = contract.NewSSHGatewayClient(u, s.sshHTTP).SetPublished(ctx, user, computer, ports)
		})
	}
	wg.Wait()
	var failed []error
	for _, err := range errs {
		switch {
		case err == nil:
			return nil
		case !errors.Is(err, contract.ErrNotFound):
			failed = append(failed, err)
		}
	}
	if len(failed) > 0 {
		return errors.Join(failed...)
	}
	return contract.ErrNotFound
}
