package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"strings"
)

// Field describes one column in a DBF table.
type Field struct {
	Name    string
	Type    byte // 'C' char, 'N' numeric, 'D' date, 'L' logical, ...
	Length  int
	Decimal int
}

// DBF is a parsed dBASE/FoxPro table. Values are returned as trimmed strings;
// the mapping layer is responsible for typed coercion.
type DBF struct {
	Fields  []Field
	Records []map[string]string
}

// ReadDBF parses a .DBF file (older Marg uses FoxPro/dBASE). Strictly read-only:
// it opens the file for reading and never writes back (PRD R1).
func ReadDBF(path string) (*DBF, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseDBF(raw)
}

func parseDBF(raw []byte) (*DBF, error) {
	if len(raw) < 33 {
		return nil, fmt.Errorf("file too small to be a DBF (%d bytes)", len(raw))
	}
	numRecords := int(binary.LittleEndian.Uint32(raw[4:8]))
	headerLen := int(binary.LittleEndian.Uint16(raw[8:10]))
	recordLen := int(binary.LittleEndian.Uint16(raw[10:12]))
	if headerLen < 33 || recordLen < 1 {
		return nil, fmt.Errorf("invalid DBF header (headerLen=%d recordLen=%d)", headerLen, recordLen)
	}

	var fields []Field
	for off := 32; off+32 <= headerLen && off+32 <= len(raw); off += 32 {
		if raw[off] == 0x0D { // field-descriptor terminator
			break
		}
		fields = append(fields, Field{
			Name:    strings.TrimRight(string(raw[off:off+11]), "\x00"),
			Type:    raw[off+11],
			Length:  int(raw[off+16]),
			Decimal: int(raw[off+17]),
		})
	}
	if len(fields) == 0 {
		return nil, fmt.Errorf("no fields found in DBF header")
	}

	records := make([]map[string]string, 0, numRecords)
	for i := 0; i < numRecords; i++ {
		start := headerLen + i*recordLen
		if start+recordLen > len(raw) {
			break
		}
		rec := raw[start : start+recordLen]
		if rec[0] == 0x2A { // deleted record
			continue
		}
		row := make(map[string]string, len(fields))
		pos := 1 // first byte is the deletion flag
		for _, f := range fields {
			if pos+f.Length > len(rec) {
				break
			}
			row[f.Name] = decodeField(rec[pos : pos+f.Length])
			pos += f.Length
		}
		records = append(records, row)
	}
	return &DBF{Fields: fields, Records: records}, nil
}

// decodeField trims a raw field value. Bytes are decoded as Latin-1 so high
// bytes never produce invalid UTF-8. NOTE: real Marg data is often cp1252 with
// Devanagari — full code-page handling (golang.org/x/text charmap) is a planned
// refinement once the spike confirms the encoding per Marg version.
func decodeField(b []byte) string {
	runes := make([]rune, len(b))
	for i, c := range b {
		runes[i] = rune(c)
	}
	return strings.TrimSpace(string(runes))
}
