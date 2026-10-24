// Native reference harness: reads test cases from stdin, writes results with full precision.
// The same cases run through the WebAssembly build; test/native-vs-wasm.test.ts compares them
// at 1e-6 dB (plan 16.1).
//
// Input, one case per line (whitespace separated):
//   itm  h_tx h_rx climate N0 f_mhz pol eps sigma mdvar time loc sit np spacing e_0 ... e_np
//   hgtc f_ghz h w_s R type
//   tsm  f_ghz d_km p
//   hzn  a_e h_tx h_rx np spacing e_0 ... e_np
// Output, one line per case: the out[] values of the bridge function, %.17g.

#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

extern "C" {
int rflp_itm_p2p(double, double, const double *, int, double, double, int, double, double, int,
                 double, double, double, double *);
void rflp_find_horizons(const double *, double, double, double, double *);
int rflp_p2108_hgtc(double, double, double, double, int, double *);
int rflp_p2108_tsm(double, double, double, double *);
}

static void print(const double *v, int n) {
    for (int i = 0; i < n; i++) std::printf(i ? " %.17g" : "%.17g", v[i]);
    std::printf("\n");
}

static std::vector<double> readProfile(std::istringstream &in) {
    double np, spacing;
    in >> np >> spacing;
    std::vector<double> pfl{np, spacing};
    for (int i = 0; i <= static_cast<int>(np); i++) {
        double e;
        in >> e;
        pfl.push_back(e);
    }
    return pfl;
}

int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream in(line);
        std::string kind;
        in >> kind;
        if (kind == "itm") {
            double h_tx, h_rx, N0, f, eps, sigma, time, loc, sit;
            int climate, pol, mdvar;
            in >> h_tx >> h_rx >> climate >> N0 >> f >> pol >> eps >> sigma >> mdvar >> time >> loc >> sit;
            std::vector<double> pfl = readProfile(in);
            double out[16];
            rflp_itm_p2p(h_tx, h_rx, pfl.data(), climate, N0, f, pol, eps, sigma, mdvar, time, loc, sit, out);
            print(out, 16);
        } else if (kind == "hgtc") {
            double f, h, ws, R;
            int type;
            in >> f >> h >> ws >> R >> type;
            double out[2];
            out[1] = rflp_p2108_hgtc(f, h, ws, R, type, out);
            print(out, 2);
        } else if (kind == "tsm") {
            double f, d, p;
            in >> f >> d >> p;
            double out[2];
            out[1] = rflp_p2108_tsm(f, d, p, out);
            print(out, 2);
        } else if (kind == "hzn") {
            double a_e, h_tx, h_rx;
            in >> a_e >> h_tx >> h_rx;
            std::vector<double> pfl = readProfile(in);
            double out[4];
            rflp_find_horizons(pfl.data(), a_e, h_tx, h_rx, out);
            print(out, 4);
        } else {
            std::fprintf(stderr, "unknown case kind: %s\n", kind.c_str());
            return 2;
        }
    }
    return 0;
}
