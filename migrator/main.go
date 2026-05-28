// Salt Migrator — reads a Marg DBF (read-only) and loads items + stock into a
// Salt org, either by writing a CSV for the web importer or by uploading
// directly with a one-time migration token.
//
// Scope: file-based (older Marg, FoxPro/DBF). The Pervasive/ODBC path for newer
// Marg is a separate effort. Marg column names are assumptions pending a spike
// on a real install — override them with --map <profile.json>.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

// Public Salt instance defaults (the publishable key is safe to ship).
const (
	defaultSupabaseURL = "https://fvjxngtqqmgjfevnoqlu.supabase.co"
	defaultAnonKey     = "sb_publishable_tsc9SKJA5YWIz2n4vvJxIw_fEGONWBE"
)

func main() {
	dbfPath := flag.String("dbf", "", "path to the Marg .DBF file (opened read-only)")
	mapPath := flag.String("map", "", "optional mapping profile JSON (overrides default Marg columns)")
	outPath := flag.String("out", "", "write the mapped data to a Salt CSV at this path")
	token := flag.String("token", "", "Salt migration upload token (from the Import screen)")
	upload := flag.Bool("upload", false, "upload to Salt using --token")
	yes := flag.Bool("yes", false, "skip the confirmation prompt before uploading")
	supaURL := flag.String("url", defaultSupabaseURL, "Salt Supabase URL")
	anonKey := flag.String("key", defaultAnonKey, "Salt publishable key")
	flag.Parse()

	if *dbfPath == "" {
		fmt.Fprintln(os.Stderr, "error: --dbf is required")
		flag.Usage()
		os.Exit(2)
	}

	profile := DefaultProfile()
	if *mapPath != "" {
		b, err := os.ReadFile(*mapPath)
		if err != nil {
			fatal(err)
		}
		if err := json.Unmarshal(b, &profile); err != nil {
			fatal(fmt.Errorf("reading mapping profile: %w", err))
		}
	}

	dbf, err := ReadDBF(*dbfPath)
	if err != nil {
		fatal(err)
	}

	items, warnings := MapRecords(dbf, profile)
	batches := 0
	for _, it := range items {
		batches += len(it.Batches)
	}

	fmt.Printf("Read %s (read-only): %d records -> %d items, %d batches\n",
		*dbfPath, len(dbf.Records), len(items), batches)
	for _, w := range warnings {
		fmt.Printf("  warning: %s\n", w)
	}

	if *outPath != "" {
		f, err := os.Create(*outPath)
		if err != nil {
			fatal(err)
		}
		defer f.Close()
		if err := WriteCSV(f, items); err != nil {
			fatal(err)
		}
		fmt.Printf("Wrote Salt CSV: %s\n", *outPath)
	}

	if *upload {
		if *token == "" {
			fatal(fmt.Errorf("--upload requires --token (generate one in Salt → Import)"))
		}
		if !*yes {
			fmt.Printf("Upload %d items / %d batches to Salt? [y/N] ", len(items), batches)
			ans, _ := bufio.NewReader(os.Stdin).ReadString('\n')
			if strings.ToLower(strings.TrimSpace(ans)) != "y" {
				fmt.Println("Aborted — nothing uploaded.")
				return
			}
		}
		res, err := Upload(*supaURL, *anonKey, *token, items)
		if err != nil {
			fatal(err)
		}
		fmt.Printf("Uploaded to Salt: %d items, %d batches.\n", res.Items, res.Batches)
	}

	if *outPath == "" && !*upload {
		fmt.Println("Nothing written. Pass --out catalog.csv and/or --upload --token <token>.")
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
