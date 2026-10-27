// Package geoiptest writes small geolocation databases for tests: 81.2.69.0/24
// is in Poland, AS5617.
package geoiptest

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"

	"github.com/holtdroid/holtdroid/internal/geoip"
)

func Databases(t testing.TB) geoip.Config {
	t.Helper()
	return geoip.Config{
		Country: write(t, "DBIP-Country-Lite", mmdbtype.Map{
			"country":   mmdbtype.Map{"iso_code": mmdbtype.String("PL")},
			"continent": mmdbtype.Map{"code": mmdbtype.String("EU")},
		}),
		ASN: write(t, "DBIP-ASN-Lite", mmdbtype.Map{
			"autonomous_system_number":       mmdbtype.Uint32(5617),
			"autonomous_system_organization": mmdbtype.String("Orange Polska"),
		}),
	}
}

func write(t testing.TB, typ string, rec mmdbtype.Map) string {
	t.Helper()
	w, err := mmdbwriter.New(mmdbwriter.Options{DatabaseType: typ, RecordSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	_, n, _ := net.ParseCIDR("81.2.69.0/24")
	if err := w.Insert(n, rec); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), typ+".mmdb")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := w.WriteTo(f); err != nil {
		t.Fatal(err)
	}
	return path
}
