#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "anthropic",
#     "boto3",
# ]
# ///
"""
한자 -> 히라가나 변환 검증 스크립트
Claude API (Opus 4.5) 사용, 100개씩 배치 처리
Anthropic API 또는 AWS Bedrock 지원

사용법:
  USE_BEDROCK=1 AWS_PROFILE=livetoon uv run scripts/kanji_checker.py input.csv output.csv
"""

import csv
import json
import sys
import os
from pathlib import Path

# API 선택: BEDROCK=1 이면 Bedrock 사용, 아니면 Anthropic 직접
USE_BEDROCK = os.environ.get("USE_BEDROCK", "0") == "1"

if USE_BEDROCK:
    import boto3
    from botocore.config import Config

    # Bedrock 클라이언트
    bedrock = boto3.client(
        "bedrock-runtime",
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
        config=Config(read_timeout=300)
    )
    MODEL_ID = "anthropic.claude-opus-4-5-20251101-v1:0"
    print(f"Using AWS Bedrock: {MODEL_ID}")
else:
    import anthropic
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 필요
    MODEL_ID = "claude-opus-4-5-20251101"
    print(f"Using Anthropic API: {MODEL_ID}")

def check_kanji_batch(pairs: list[dict]) -> list[dict]:
    """
    100개씩 배치로 한자-히라가나 쌍 검증
    pairs: [{"kanji": "漢字", "hiragana": "かんじ"}, ...]
    """

    prompt = f"""다음 한자와 히라가나 읽기 쌍이 올바른지 검증해주세요.

입력 데이터:
{json.dumps(pairs, ensure_ascii=False, indent=2)}

각 항목에 대해 다음 JSON 배열 형식으로 답변해주세요:
[
  {{"index": 0, "kanji": "漢字", "hiragana": "かんじ", "correct": true, "correct_reading": "かんじ", "note": ""}},
  {{"index": 1, "kanji": "今日", "hiragana": "きょう", "correct": true, "correct_reading": "きょう", "note": ""}},
  {{"index": 2, "kanji": "明日", "hiragana": "あした", "correct": true, "correct_reading": "あした/みょうにち", "note": "복수 읽기 가능"}}
]

규칙:
- correct: 입력된 히라가나가 해당 한자의 올바른 읽기인지 (true/false)
- correct_reading: 올바른 읽기 (복수면 / 로 구분)
- note: 특이사항 (복수 읽기, 문맥 의존 등)

JSON 배열만 출력하세요."""

    if USE_BEDROCK:
        # AWS Bedrock API 호출
        request_body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 8192,
            "messages": [{"role": "user", "content": prompt}]
        })

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            body=request_body,
            contentType="application/json",
            accept="application/json"
        )

        response_body = json.loads(response["body"].read())
        response_text = response_body["content"][0]["text"]
    else:
        # Anthropic API 직접 호출
        response = client.messages.create(
            model=MODEL_ID,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}]
        )
        response_text = response.content[0].text
    # JSON 블록 추출
    if "```json" in response_text:
        response_text = response_text.split("```json")[1].split("```")[0]
    elif "```" in response_text:
        response_text = response_text.split("```")[1].split("```")[0]

    return json.loads(response_text.strip())


def process_file(input_path: str, output_path: str, batch_size: int = 100):
    """
    입력 파일 처리 후 CSV 출력
    입력 형식: CSV (kanji,hiragana) 또는 TSV
    """

    # 입력 파일 읽기
    pairs = []
    with open(input_path, 'r', encoding='utf-8') as f:
        # 구분자 자동 감지
        first_line = f.readline()
        f.seek(0)

        if '\t' in first_line:
            delimiter = '\t'
        else:
            delimiter = ','

        reader = csv.reader(f, delimiter=delimiter)

        # 헤더 체크
        header = next(reader, None)
        if header and header[0].lower() in ['kanji', '漢字', 'word']:
            pass  # 헤더 스킵
        else:
            f.seek(0)  # 헤더 없으면 처음으로
            reader = csv.reader(f, delimiter=delimiter)

        for row in reader:
            if len(row) >= 2:
                pairs.append({"kanji": row[0].strip(), "hiragana": row[1].strip()})

    print(f"총 {len(pairs)}개 항목 로드됨")

    # 배치 처리
    all_results = []
    for i in range(0, len(pairs), batch_size):
        batch = pairs[i:i+batch_size]
        print(f"처리 중: {i+1}-{min(i+batch_size, len(pairs))} / {len(pairs)}")

        try:
            results = check_kanji_batch(batch)
            all_results.extend(results)
        except Exception as e:
            print(f"에러 발생 (배치 {i//batch_size + 1}): {e}")
            # 에러난 배치는 수동 체크 필요로 마킹
            for j, pair in enumerate(batch):
                all_results.append({
                    "index": i + j,
                    "kanji": pair["kanji"],
                    "hiragana": pair["hiragana"],
                    "correct": None,
                    "correct_reading": "",
                    "note": f"ERROR: {str(e)}"
                })

    # CSV 출력
    with open(output_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(["index", "kanji", "input_hiragana", "correct", "correct_reading", "note"])

        for r in all_results:
            writer.writerow([
                r.get("index", ""),
                r.get("kanji", ""),
                r.get("hiragana", ""),
                r.get("correct", ""),
                r.get("correct_reading", ""),
                r.get("note", "")
            ])

    # 통계
    correct_count = sum(1 for r in all_results if r.get("correct") == True)
    incorrect_count = sum(1 for r in all_results if r.get("correct") == False)
    error_count = sum(1 for r in all_results if r.get("correct") is None)

    print(f"\n=== 결과 ===")
    print(f"정답: {correct_count}")
    print(f"오답: {incorrect_count}")
    print(f"에러: {error_count}")
    print(f"출력: {output_path}")


def main():
    if len(sys.argv) < 2:
        print("사용법: python kanji_checker.py <input.csv> [output.csv] [batch_size]")
        print("")
        print("입력 파일 형식 (CSV 또는 TSV):")
        print("  漢字,かんじ")
        print("  今日,きょう")
        print("  明日,あした")
        print("")
        print("예시:")
        print("  python kanji_checker.py words.csv results.csv 100")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "kanji_check_results.csv"
    batch_size = int(sys.argv[3]) if len(sys.argv) > 3 else 100

    if not Path(input_path).exists():
        print(f"파일을 찾을 수 없음: {input_path}")
        sys.exit(1)

    process_file(input_path, output_path, batch_size)


if __name__ == "__main__":
    main()
