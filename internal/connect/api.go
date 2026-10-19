package connect

import (
	"crypto/tls"
	"net/http"
	"time"
)

// HTTPClient talks to a portal; insecure accepts any TLS certificate.
func HTTPClient(insecure bool) *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	if insecure {
		t.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // only for portals the user marked as self-signed
	}
	return &http.Client{Transport: t, Timeout: time.Minute}
}

// SavedInsecure says whether this computer accepts portal's certificate
// without checking it, from an earlier --insecure.
func SavedInsecure(portal string) bool {
	root, err := Dir()
	if err != nil {
		return false
	}
	s, err := storeFor(root, portal)
	if err != nil {
		return false
	}
	st, err := s.load()
	return err == nil && st.Insecure
}
