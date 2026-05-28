package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Profile maps Marg DBF column names to Salt fields.
//
// IMPORTANT: the default column names are ASSUMPTIONS pending a real-Marg
// schema spike (per the migrator PRD, every Marg table/column is unconfirmed).
// Override per Marg version with --map <profile.json> — no code change needed.
type Profile struct {
	Name         string `json:"name"`
	Salt         string `json:"salt"`
	Manufacturer string `json:"manufacturer"`
	Pack         string `json:"pack"`
	HSN          string `json:"hsn"`
	GstRate      string `json:"gst_rate"`
	Schedule     string `json:"schedule"`
	Barcode      string `json:"barcode"`
	BatchNo      string `json:"batch_no"`
	Expiry       string `json:"expiry"`
	Qty          string `json:"qty"`
	Mrp          string `json:"mrp"`
	Ptr          string `json:"ptr"`
	// MoneyInPaise: source MRP/PTR are already paise (else treated as rupees).
	MoneyInPaise bool `json:"money_in_paise"`
}

func DefaultProfile() Profile {
	return Profile{
		Name: "NAME", Salt: "SALT", Manufacturer: "COMPANY", Pack: "PACK",
		HSN: "HSN", GstRate: "GST", Schedule: "SCHEDULE", Barcode: "BARCODE",
		BatchNo: "BATCH", Expiry: "EXPIRY", Qty: "QTY", Mrp: "MRP", Ptr: "PTR",
	}
}

var validSchedules = map[string]bool{"OTC": true, "H": true, "H1": true, "X": true}

// MapRecords transforms DBF rows into Salt items grouped by name+manufacturer.
// Returns the items and a list of human-readable warnings.
func MapRecords(dbf *DBF, p Profile) ([]SaltItem, []string) {
	var order []string
	byKey := map[string]*SaltItem{}
	var warnings []string

	for i, rec := range dbf.Records {
		line := i + 1
		name := strings.TrimSpace(rec[p.Name])
		if name == "" {
			warnings = append(warnings, fmt.Sprintf("record %d: missing %q, skipped", line, p.Name))
			continue
		}

		qty, err := strconv.Atoi(strings.TrimSpace(rec[p.Qty]))
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: bad quantity %q, set to 0", name, rec[p.Qty]))
			qty = 0
		}

		sched := strings.ToUpper(strings.TrimSpace(rec[p.Schedule]))
		if sched == "" {
			sched = "OTC"
		} else if !validSchedules[sched] {
			warnings = append(warnings, fmt.Sprintf("%s: unknown schedule %q, set to OTC", name, sched))
			sched = "OTC"
		}

		manufacturer := strings.TrimSpace(rec[p.Manufacturer])
		key := strings.ToLower(name) + "|" + strings.ToLower(manufacturer)
		item := byKey[key]
		if item == nil {
			item = &SaltItem{
				Name:         name,
				Salt:         strings.TrimSpace(rec[p.Salt]),
				Manufacturer: manufacturer,
				Pack:         strings.TrimSpace(rec[p.Pack]),
				HSN:          strings.TrimSpace(rec[p.HSN]),
				GstRate:      parseFloat(rec[p.GstRate]),
				Schedule:     sched,
				Barcode:      strings.TrimSpace(rec[p.Barcode]),
			}
			byKey[key] = item
			order = append(order, key)
		}
		item.Batches = append(item.Batches, SaltBatch{
			BatchNo:  strings.TrimSpace(rec[p.BatchNo]),
			Expiry:   normalizeExpiry(rec[p.Expiry]),
			Qty:      qty,
			MrpPaise: toPaise(rec[p.Mrp], p.MoneyInPaise),
			PtrPaise: toPaise(rec[p.Ptr], p.MoneyInPaise),
		})
	}

	items := make([]SaltItem, 0, len(order))
	for _, k := range order {
		items = append(items, *byKey[k])
	}
	return items, warnings
}

func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}

func toPaise(s string, alreadyPaise bool) int {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if alreadyPaise {
		return int(math.Round(f))
	}
	return int(math.Round(f * 100))
}

// normalizeExpiry coerces common formats to YYYY-MM where possible.
func normalizeExpiry(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) == 8 && isDigits(s) { // YYYYMMDD
		return s[:4] + "-" + s[4:6]
	}
	if len(s) >= 7 && s[4] == '-' { // YYYY-MM or YYYY-MM-DD
		return s[:7]
	}
	return s
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
