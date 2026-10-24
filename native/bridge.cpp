// Thin C bridge over NTIA ITM and NTIA P.2108, compiled identically into the WebAssembly
// module and the native reference harness. It adds no physics: every number comes from the
// NTIA functions. Validation of geometry happens in the TypeScript wrapper (plan 4.1, T1).

// P2108.h first: itm.h #defines PI, which would break P2108.h's `constexpr double PI`.
#include "../third_party/ntia-p2108/include/P2108.h"
#include "../third_party/ntia-itm/include/itm.h"

namespace P2108 = ITS::ITU::PSeries::P2108;

extern "C" {

// Layout of `out` (16 doubles), shared with src/wasm.ts:
//  0 return code, 1 basic transmission loss A (dB), 2 warnings bitmask,
//  3-4 horizon angles (rad), 5-6 horizon distances (m), 7-8 effective heights (m),
//  9 Ns, 10 delta_h (m), 11 A_ref (dB), 12 A_fs (dB), 13 d (km), 14 propagation mode
int rflp_itm_p2p(double h_tx, double h_rx, const double *pfl, int climate, double N_0,
                 double f_mhz, int pol, double epsilon, double sigma, int mdvar, double time,
                 double location, double situation, double *out) {
    IntermediateValues iv = {};
    double A = 0;
    long warnings = 0;
    const int rtn = ITM_P2P_TLS_Ex(h_tx, h_rx, pfl, climate, N_0, f_mhz, pol, epsilon, sigma,
                                   mdvar, time, location, situation, &A, &warnings, &iv);
    out[0] = rtn;
    out[1] = A;
    out[2] = static_cast<double>(warnings);
    out[3] = iv.theta_hzn[0];
    out[4] = iv.theta_hzn[1];
    out[5] = iv.d_hzn__meter[0];
    out[6] = iv.d_hzn__meter[1];
    out[7] = iv.h_e__meter[0];
    out[8] = iv.h_e__meter[1];
    out[9] = iv.N_s;
    out[10] = iv.delta_h__meter;
    out[11] = iv.A_ref__db;
    out[12] = iv.A_fs__db;
    out[13] = iv.d__km;
    out[14] = iv.mode;
    out[15] = 0;
    return rtn;
}

// Raw terrain horizons (plan 4.1: QuickPfl may replace them with fitted values on LOS paths).
// out: theta_hzn[0], theta_hzn[1] (rad), d_hzn[0], d_hzn[1] (m)
void rflp_find_horizons(const double *pfl, double a_e_meter, double h_tx, double h_rx,
                        double *out) {
    const double h[2] = {h_tx, h_rx};
    double theta[2], d[2];
    FindHorizons(pfl, a_e_meter, h, theta, d);
    out[0] = theta[0];
    out[1] = theta[1];
    out[2] = d[0];
    out[3] = d[1];
}

// P.2108 section 3.1 height-gain terminal correction. out[0] = A_h (dB).
int rflp_p2108_hgtc(double f_ghz, double h_meter, double w_s_meter, double R_meter,
                    int clutter_type, double *out) {
    double A_h = 0;
    const int rtn = P2108::HeightGainTerminalCorrectionModel(
        f_ghz, h_meter, w_s_meter, R_meter, static_cast<P2108::ClutterType>(clutter_type), A_h);
    out[0] = A_h;
    return rtn;
}

// P.2108 section 3.2 terrestrial statistical model. out[0] = L_ctt (dB).
int rflp_p2108_tsm(double f_ghz, double d_km, double p, double *out) {
    double L = 0;
    const int rtn = P2108::TerrestrialStatisticalModel(f_ghz, d_km, p, L);
    out[0] = L;
    return rtn;
}

}  // extern "C"
