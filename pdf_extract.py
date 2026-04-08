import os
import pypdf

files = [
    r"c:\Users\korloy\OneDrive - 다인그룹\바탕 화면\자동화 프로그램\AutoCalulator v1.0.0\참고논문\1-s2.0-S0272884217316905-main.pdf",
    r"c:\Users\korloy\OneDrive - 다인그룹\바탕 화면\자동화 프로그램\AutoCalulator v1.0.0\참고논문\main.pdf"
]

with open('pdf_text.md', 'w', encoding='utf-8') as outfile:
    for file in files:
        if os.path.exists(file):
            outfile.write(f"# PDF: {os.path.basename(file)}\n\n")
            reader = pypdf.PdfReader(file)
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    outfile.write(text + "\n")
            outfile.write("\n---\n")
