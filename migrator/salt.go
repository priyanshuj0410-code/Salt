package main

import (
	"encoding/csv"
	"io"
	"strconv"
)

// SaltBatch is one batch destined for Salt. Money is in paise (canonical).
type SaltBatch struct {
	BatchNo  string `json:"batch_no"`
	Expiry   string `json:"expiry"`
	Qty      int    `json:"qty"`
	MrpPaise int    `json:"mrp_paise"`
	PtrPaise int    `json:"ptr_paise"`
}

// SaltItem is one item plus its batches, destined for Salt.
type SaltItem struct {
	Name         string      `json:"name"`
	Salt         string      `json:"salt"`
	Manufacturer string      `json:"manufacturer"`
	Pack         string      `json:"pack"`
	HSN          string      `json:"hsn"`
	GstRate      float64     `json:"gst_rate"`
	Schedule     string      `json:"schedule"`
	Barcode      string      `json:"barcode"`
	Batches      []SaltBatch `json:"batches"`
}

func paiseToRupees(p int) string {
	return strconv.FormatFloat(float64(p)/100, 'f', 2, 64)
}

// WriteCSV emits the rows in the same shape the Salt web importer accepts
// (one row per batch, MRP/PTR in rupees).
func WriteCSV(w io.Writer, items []SaltItem) error {
	cw := csv.NewWriter(w)
	header := []string{
		"name", "salt", "manufacturer", "pack", "hsn", "gst_rate",
		"schedule", "barcode", "batch_no", "expiry", "qty", "mrp", "ptr",
	}
	if err := cw.Write(header); err != nil {
		return err
	}
	for _, it := range items {
		gst := strconv.FormatFloat(it.GstRate, 'f', -1, 64)
		for _, b := range it.Batches {
			if err := cw.Write([]string{
				it.Name, it.Salt, it.Manufacturer, it.Pack, it.HSN, gst,
				it.Schedule, it.Barcode, b.BatchNo, b.Expiry,
				strconv.Itoa(b.Qty), paiseToRupees(b.MrpPaise), paiseToRupees(b.PtrPaise),
			}); err != nil {
				return err
			}
		}
	}
	cw.Flush()
	return cw.Error()
}
