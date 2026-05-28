package main

import (
	"encoding/binary"
	"testing"
)

// writeDBF builds a minimal dBASE III file in memory (test fixture only).
func writeDBF(fields []Field, records []map[string]string) []byte {
	headerLen := 32 + 32*len(fields) + 1
	recordLen := 1
	for _, f := range fields {
		recordLen += f.Length
	}
	buf := make([]byte, headerLen)
	buf[0] = 0x03
	binary.LittleEndian.PutUint32(buf[4:8], uint32(len(records)))
	binary.LittleEndian.PutUint16(buf[8:10], uint16(headerLen))
	binary.LittleEndian.PutUint16(buf[10:12], uint16(recordLen))
	for i, f := range fields {
		off := 32 + i*32
		copy(buf[off:off+11], f.Name)
		buf[off+11] = f.Type
		buf[off+16] = byte(f.Length)
		buf[off+17] = byte(f.Decimal)
	}
	buf[headerLen-1] = 0x0D

	for _, rec := range records {
		row := make([]byte, recordLen)
		row[0] = 0x20
		pos := 1
		for _, f := range fields {
			val := rec[f.Name]
			if len(val) > f.Length {
				val = val[:f.Length]
			}
			cell := make([]byte, f.Length)
			for i := range cell {
				cell[i] = ' '
			}
			if f.Type == 'N' { // numeric is right-justified
				copy(cell[f.Length-len(val):], val)
			} else {
				copy(cell, val)
			}
			copy(row[pos:pos+f.Length], cell)
			pos += f.Length
		}
		buf = append(buf, row...)
	}
	return append(buf, 0x1A)
}

func TestDBFRoundTrip(t *testing.T) {
	fields := []Field{
		{Name: "NAME", Type: 'C', Length: 20},
		{Name: "QTY", Type: 'N', Length: 6},
		{Name: "MRP", Type: 'N', Length: 8, Decimal: 2},
	}
	records := []map[string]string{
		{"NAME": "Dolo 650", "QTY": "240", "MRP": "31.50"},
		{"NAME": "Pan 40", "QTY": "30", "MRP": "168.00"},
	}

	dbf, err := parseDBF(writeDBF(fields, records))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(dbf.Fields) != 3 {
		t.Fatalf("fields = %d, want 3", len(dbf.Fields))
	}
	if len(dbf.Records) != 2 {
		t.Fatalf("records = %d, want 2", len(dbf.Records))
	}
	if got := dbf.Records[0]["NAME"]; got != "Dolo 650" {
		t.Errorf("NAME = %q, want Dolo 650", got)
	}
	if got := dbf.Records[0]["QTY"]; got != "240" {
		t.Errorf("QTY = %q, want 240", got)
	}
	if got := dbf.Records[1]["MRP"]; got != "168.00" {
		t.Errorf("MRP = %q, want 168.00", got)
	}
}
