package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/minio/minio-go/v7/pkg/credentials"
)

// brokerCredentials fetches temporary keys in the ECS container credentials
// format ({AccessKeyId, SecretAccessKey, Token, Expiration}) from a URL.
type brokerCredentials struct {
	credentials.Expiry
	url    string
	token  string
	client *http.Client
}

func (b *brokerCredentials) Retrieve() (credentials.Value, error) {
	return b.RetrieveWithCredContext(nil)
}

func (b *brokerCredentials) RetrieveWithCredContext(*credentials.CredContext) (credentials.Value, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.url, nil)
	if err != nil {
		return credentials.Value{}, err
	}
	if b.token != "" {
		req.Header.Set("Authorization", b.token)
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return credentials.Value{}, fmt.Errorf("credentials broker: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return credentials.Value{}, fmt.Errorf("credentials broker: %s", resp.Status)
	}
	var body struct {
		AccessKeyID     string `json:"AccessKeyId"`
		SecretAccessKey string `json:"SecretAccessKey"`
		Token           string `json:"Token"`
		Expiration      time.Time
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return credentials.Value{}, fmt.Errorf("credentials broker: %w", err)
	}
	if body.AccessKeyID == "" || body.SecretAccessKey == "" {
		return credentials.Value{}, errors.New("credentials broker: empty credentials")
	}
	expires := body.Expiration
	if expires.IsZero() {
		expires = time.Now().Add(5 * time.Minute)
	}
	b.SetExpiration(expires, time.Minute)
	return credentials.Value{
		AccessKeyID:     body.AccessKeyID,
		SecretAccessKey: body.SecretAccessKey,
		SessionToken:    body.Token,
		Expiration:      expires,
		SignerType:      credentials.SignatureV4,
	}, nil
}
