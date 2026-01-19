import json
import re
from pathlib import Path

ROC_PATH = Path(__file__).resolve().parents[1] / "roc.js"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "roc_ber_curve.svg"


def load_roc_values():
    text = ROC_PATH.read_text(encoding="utf-8")
    anchor = re.search(r"let\s+ROC_VALUES\s*=\s*\[", text)
    if not anchor:
        raise RuntimeError("ROC_VALUES array not found in roc.js")
    start = anchor.end() - 1
    depth = 0
    end = None
    for index in range(start, len(text)):
        char = text[index]
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise RuntimeError("Failed to parse ROC_VALUES array bounds")
    roc_json = text[start:end]
    return json.loads(roc_json)


def roc_find_entry_by_fpr(values, desired_fpr):
    best_match = values[0]
    for entry in reversed(values):
        if entry["fpr"] < desired_fpr:
            best_match = entry
            break
    return best_match


def estimate_linear_score_at_threshold(values, threshold):
    lower = values[-1]
    upper = values[0]
    for index, entry in enumerate(values):
        if entry["threshold"] < threshold:
            lower = entry
            upper = values[max(index - 1, 0)]
            break
    if upper["threshold"] == lower["threshold"]:
        fpr = lower["fpr"]
        fnr = 1.0 - lower["tpr"]
        return (fpr + fnr) / 2.0
    ratio = (threshold - lower["threshold"]) / (upper["threshold"] - lower["threshold"])
    fpr = lower["fpr"] + (upper["fpr"] - lower["fpr"]) * ratio
    tpr = lower["tpr"] + (upper["tpr"] - lower["tpr"]) * ratio
    fnr = 1.0 - tpr
    return (fpr + fnr) / 2.0


def main():
    values = load_roc_values()
    thresholds = [entry["threshold"] for entry in values]
    linear_scores = [(entry["fpr"] + (1.0 - entry["tpr"])) / 2.0 for entry in values]

    trusted = roc_find_entry_by_fpr(values, 0.004)
    neutral = roc_find_entry_by_fpr(values, 0.015)
    untrusted = roc_find_entry_by_fpr(values, 0.10)

    thresholds_sorted, linear_sorted = zip(*sorted(zip(thresholds, linear_scores)))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    width = 900
    height = 500
    margin = 60
    plot_width = width - margin * 2
    plot_height = height - margin * 2

    min_threshold = min(thresholds_sorted)
    max_threshold = max(thresholds_sorted)
    min_linear = min(linear_sorted)
    max_linear = max(linear_sorted)

    def scale_x(value):
        if max_threshold == min_threshold:
            return margin
        return margin + (value - min_threshold) / (max_threshold - min_threshold) * plot_width

    def scale_y(value):
        if max_linear == min_linear:
            return margin + plot_height
        return margin + plot_height - (value - min_linear) / (max_linear - min_linear) * plot_height

    points = " ".join(f"{scale_x(x):.2f},{scale_y(y):.2f}" for x, y in zip(thresholds_sorted, linear_sorted))

    vertical_markers = [
        ("trusted", trusted, "#2e7d32"),
        ("neutral", neutral, "#f9a825"),
        ("untrusted", untrusted, "#c62828"),
    ]

    svg_lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="{width / 2}" y="{margin / 2}" text-anchor="middle" font-size="16" font-family="Arial">ROC threshold vs BER linear score</text>',
        f'<text x="{width / 2}" y="{height - 10}" text-anchor="middle" font-size="12" font-family="Arial">ROC threshold</text>',
        f'<text x="15" y="{height / 2}" text-anchor="middle" font-size="12" font-family="Arial" transform="rotate(-90, 15, {height / 2})">BER linear score ((FPR+FNR)/2)</text>',
        f'<polyline fill="none" stroke="#1565c0" stroke-width="2" points="{points}"/>'
    ]

    for name, entry, color in vertical_markers:
        x = scale_x(entry["threshold"])
        svg_lines.append(f'<line x1="{x:.2f}" y1="{margin}" x2="{x:.2f}" y2="{height - margin}" stroke="{color}" stroke-dasharray="4,4" stroke-width="1.5"/>')
        svg_lines.append(f'<text x="{x + 4:.2f}" y="{margin + 12}" font-size="11" font-family="Arial" fill="{color}" transform="rotate(90, {x + 4:.2f}, {margin + 12})">{name}</text>')

    svg_lines.append("</svg>")
    OUTPUT_PATH.write_text("\n".join(svg_lines), encoding="utf-8")

    for label, entry in [
        ("trusted", trusted),
        ("neutral", neutral),
        ("untrusted", untrusted),
    ]:
        linear = estimate_linear_score_at_threshold(values, entry["threshold"])
        print(f"{label}: threshold={entry['threshold']:.6f}, linear={linear:.6f}")

    print(f"Saved plot to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
