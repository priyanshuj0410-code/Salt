package main

import "testing"

func TestMapRecords(t *testing.T) {
	fields := []Field{
		{Name: "NAME", Type: 'C', Length: 20},
		{Name: "COMPANY", Type: 'C', Length: 12},
		{Name: "SCHEDULE", Type: 'C', Length: 4},
		{Name: "GST", Type: 'N', Length: 5, Decimal: 2},
		{Name: "BATCH", Type: 'C', Length: 10},
		{Name: "EXPIRY", Type: 'C', Length: 8},
		{Name: "QTY", Type: 'N', Length: 6},
		{Name: "MRP", Type: 'N', Length: 8, Decimal: 2},
		{Name: "PTR", Type: 'N', Length: 8, Decimal: 2},
	}
	records := []map[string]string{
		{"NAME": "Pan 40", "COMPANY": "Alkem", "SCHEDULE": "H", "GST": "12", "BATCH": "PN2503", "EXPIRY": "20260601", "QTY": "30", "MRP": "168.00", "PTR": "134.40"},
		{"NAME": "Pan 40", "COMPANY": "Alkem", "SCHEDULE": "H", "GST": "12", "BATCH": "PN2508", "EXPIRY": "20270401", "QTY": "120", "MRP": "168.00", "PTR": "132.00"},
		{"NAME": "Dolo 650", "COMPANY": "Micro", "SCHEDULE": "ZZ", "GST": "12", "BATCH": "DL1", "EXPIRY": "20270301", "QTY": "240", "MRP": "31.50", "PTR": "25.20"},
	}

	dbf, err := parseDBF(writeDBF(fields, records))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	items, warnings := MapRecords(dbf, DefaultProfile())

	if len(items) != 2 {
		t.Fatalf("items = %d, want 2 (Pan 40 grouped + Dolo)", len(items))
	}

	var pan, dolo *SaltItem
	for i := range items {
		switch items[i].Name {
		case "Pan 40":
			pan = &items[i]
		case "Dolo 650":
			dolo = &items[i]
		}
	}
	if pan == nil || len(pan.Batches) != 2 {
		t.Fatalf("Pan 40 should have 2 batches")
	}
	if pan.Batches[0].MrpPaise != 16800 {
		t.Errorf("Pan 40 MRP paise = %d, want 16800", pan.Batches[0].MrpPaise)
	}
	if pan.Batches[0].PtrPaise != 13440 {
		t.Errorf("Pan 40 PTR paise = %d, want 13440", pan.Batches[0].PtrPaise)
	}
	if pan.Batches[0].Expiry != "2026-06" {
		t.Errorf("Pan 40 expiry = %q, want 2026-06", pan.Batches[0].Expiry)
	}
	if dolo == nil || dolo.Schedule != "OTC" {
		t.Errorf("Dolo unknown schedule should default to OTC")
	}
	if len(warnings) == 0 {
		t.Errorf("expected a warning for the unknown schedule")
	}
}
