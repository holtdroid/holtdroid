package apk

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"image/png"
	"slices"
	"strings"

	androidapk "github.com/shogo82148/androidbinary/apk"
)

type Metadata struct {
	Package     string   `json:"package"`
	VersionName string   `json:"versionName,omitempty"`
	VersionCode int32    `json:"versionCode,omitempty"`
	Label       string   `json:"label,omitempty"`
	MinSDK      int32    `json:"minSdk,omitempty"`
	TargetSDK   int32    `json:"targetSdk,omitempty"`
	ABIs        []string `json:"abis"`
}

// Parse reads package metadata and, when the launcher icon is a bitmap, a PNG
// of it. Adaptive (XML) icons yield a nil icon.
func Parse(path string) (Metadata, []byte, error) {
	pkg, err := androidapk.OpenFile(path)
	if err != nil {
		return Metadata{}, nil, fmt.Errorf("open apk: %w", err)
	}
	defer pkg.Close()

	m := pkg.Manifest()
	meta := Metadata{Package: pkg.PackageName()}
	if meta.Package == "" {
		return Metadata{}, nil, errors.New("apk has no package name")
	}
	meta.VersionName, _ = m.VersionName.String()
	meta.VersionCode, _ = m.VersionCode.Int32()
	meta.MinSDK, _ = m.SDK.Min.Int32()
	meta.TargetSDK, _ = m.SDK.Target.Int32()
	meta.Label, _ = pkg.Label(nil)

	meta.ABIs, err = abis(path)
	if err != nil {
		return Metadata{}, nil, err
	}

	var icon []byte
	if img, err := pkg.Icon(nil); err == nil && img != nil {
		var buf bytes.Buffer
		if png.Encode(&buf, img) == nil {
			icon = buf.Bytes()
		}
	}
	return meta, icon, nil
}

func abis(path string) ([]string, error) {
	z, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	out := []string{}
	for _, f := range z.File {
		rest, ok := strings.CutPrefix(f.Name, "lib/")
		if !ok {
			continue
		}
		abi, _, ok := strings.Cut(rest, "/")
		if ok && abi != "" && !slices.Contains(out, abi) {
			out = append(out, abi)
		}
	}
	slices.Sort(out)
	return out, nil
}
