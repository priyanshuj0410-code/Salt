package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type uploadResult struct {
	Items   int `json:"items"`
	Batches int `json:"batches"`
}

// Upload redeems a migration token and pushes the items into the token's org
// via the redeem_migration_token RPC. The token is the bearer credential; the
// publishable key is public (safe to ship in this open-source tool).
func Upload(supabaseURL, anonKey, token string, items []SaltItem) (*uploadResult, error) {
	body, err := json.Marshal(map[string]any{"p_token": token, "p_items": items})
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(supabaseURL, "/") + "/rest/v1/rpc/redeem_migration_token"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", anonKey)
	req.Header.Set("Authorization", "Bearer "+anonKey)

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upload failed (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var res uploadResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("unexpected response: %s", strings.TrimSpace(string(raw)))
	}
	return &res, nil
}
