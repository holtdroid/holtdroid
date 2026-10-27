// Package geoip tells where an address is from MaxMind-format databases:
// a country one and an ASN one, DB-IP Lite in the image.
package geoip

import (
	"errors"
	"fmt"
	"io/fs"
	"net/netip"
	"time"

	"github.com/oschwald/maxminddb-golang/v2"

	"github.com/holtdroid/holtdroid/internal/contract"
	"github.com/holtdroid/holtdroid/internal/netem"
)

type Config struct {
	Country string
	ASN     string
}

// DB looks addresses up; a database that isn't there leaves its fields
// empty.
type DB struct {
	country *maxminddb.Reader
	asn     *maxminddb.Reader
}

// Open opens the databases cfg names; a path that doesn't exist is skipped,
// and Missing says which.
func Open(cfg Config) (*DB, error) {
	var d DB
	var err error
	if d.country, err = open(cfg.Country); err != nil {
		return nil, fmt.Errorf("geoIP.country: %w", err)
	}
	if d.asn, err = open(cfg.ASN); err != nil {
		return nil, fmt.Errorf("geoIP.asn: %w", err)
	}
	return &d, nil
}

func open(path string) (*maxminddb.Reader, error) {
	if path == "" {
		return nil, nil
	}
	r, err := maxminddb.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	return r, err
}

func (d *DB) Missing() (country, asn bool) { return d.country == nil, d.asn == nil }

// Built is when the newer database was built; zero without one.
func (d *DB) Built() time.Time {
	var t time.Time
	for _, r := range []*maxminddb.Reader{d.country, d.asn} {
		if r == nil {
			continue
		}
		if b := time.Unix(int64(r.Metadata.BuildEpoch), 0).UTC(); b.After(t) {
			t = b
		}
	}
	return t
}

type countryRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	Continent struct {
		Code string `maxminddb:"code"`
	} `maxminddb:"continent"`
}

type asnRecord struct {
	Number uint   `maxminddb:"autonomous_system_number"`
	Org    string `maxminddb:"autonomous_system_organization"`
}

func (d *DB) Lookup(addr netip.Addr) contract.IPInfo {
	addr = addr.Unmap()
	info := contract.IPInfo{Address: addr.String()}
	if addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsUnspecified() || netem.CGNAT(addr) {
		info.Private = true
		return info
	}
	info.CDN = netem.CDN(addr)
	if d.country != nil {
		var r countryRecord
		if err := d.country.Lookup(addr).Decode(&r); err == nil {
			info.Country, info.Continent = r.Country.ISOCode, r.Continent.Code
		}
	}
	if d.asn != nil {
		var r asnRecord
		if err := d.asn.Lookup(addr).Decode(&r); err == nil {
			info.ASN, info.Org = r.Number, r.Org
		}
	}
	return info
}

func (d *DB) Close() error {
	var errs []error
	for _, r := range []*maxminddb.Reader{d.country, d.asn} {
		if r != nil {
			errs = append(errs, r.Close())
		}
	}
	return errors.Join(errs...)
}
